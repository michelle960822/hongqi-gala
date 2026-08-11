/* ============ 红旗粉丝家年华 · 报名记录 API（AES-256-GCM 加密版）============
 * 安全设计：
 * - id_number / phone 列存 AES-GCM 密文（base64：12 字节 IV + 密文 + 16 字节 auth tag）
 * - id_hmac / phone_hmac 列存 HMAC-SHA256 截断，用于查重索引（不解密即可判等）
 * - id_masked / phone_masked 列存脱敏值（110101********1234 / 138****5678），用于默认展示
 * - 列表接口默认返回 *_masked；?full=1 + admin_pin 才解密返回原文
 * - 密钥：优先 env.ID_ENC_KEY / env.HMAC_KEY，缺失则用代码内 fallback（部署即可用，生产建议改 env）
 * ======================================================= */

const ADMIN_PIN_DEFAULT = '404112';
const ACTIVITY_END = '2026-08-15';
const RETENTION_DAYS = 30;

// 密钥 fallback（生产建议通过 CF Pages 环境变量 ID_ENC_KEY / HMAC_KEY 覆盖）
const DEV_ID_ENC_KEY = 'NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=';
const DEV_HMAC_KEY   = 'N+n/LSL+Z1Zd6RMZ1cx34qjkxnO9fFM8koPLN9Xnths=';

// 缓存密钥导入结果（每个 isolate 生命周期内复用）
let _aesKeyCache = null;
let _hmacKeyCache = null;

export async function onRequestGet(context) {
  const { env, request } = context;
  return jsonResp(await listRecords(env, request));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  return jsonResp(await createRecord(request, env));
}

async function listRecords(env, request) {
  if (!env.DB) return { error: 'DB binding missing', hint: '在 Pages Settings → Functions → D1 database bindings 配置 DB' };
  await ensureSchema(env);
  await migrateLegacyRows(env);

  const url = new URL(request.url);
  const wantFull = url.searchParams.get('full') === '1';
  const adminPin = url.searchParams.get('admin_pin') || '';

  if (wantFull && adminPin !== ADMIN_PIN_DEFAULT) {
    return { error: 'unauthorized', hint: '需要管理员 PIN 才能查看完整数据' };
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM records ORDER BY created_at DESC'
    ).all();
    let records = results || [];

    if (!wantFull) {
      // 默认：返回脱敏值（不解密）
      records = records.map(r => ({
        ...r,
        id_number: r.id_masked || maskIdNumber(r.id_number),
        phone: r.phone_masked || maskPhone(r.phone),
      }));
    } else {
      // 明文：解密 id_number / phone（async 操作必须用 Promise.all）
      const aesKey = await getAesKey(env);
      records = await Promise.all(records.map(async r => ({
        ...r,
        id_number: await safeDecrypt(r.id_number, aesKey),
        phone: await safeDecrypt(r.phone, aesKey),
      })));
      await logAccess(env, request, 'records_full_export', { count: records.length });
    }

    return { records };
  } catch (err) {
    return { error: 'DB query failed: ' + err.message };
  }
}

async function createRecord(request, env) {
  if (!env.DB) return { error: 'DB binding missing' };
  await ensureSchema(env);

  let r;
  try { r = await request.json(); } catch { return { error: 'invalid json' }; }
  if (!r) return { error: 'empty body' };

  const required = ['id', 'roleId', 'roleName', 'slotIdx', 'date', 'dateLabel', 'time', 'realName', 'idNumber', 'phone'];
  for (const k of required) {
    if (r[k] === undefined || r[k] === null || r[k] === '') {
      return { error: `missing_field: ${k}` };
    }
  }

  const idNumberPlain = String(r.idNumber).toUpperCase();
  const phonePlain = String(r.phone);

  const aesKey = await getAesKey(env);
  const hmacKey = await getHmacKey(env);

  const idHmac = await hmacHex(idNumberPlain, hmacKey);
  const phoneHmac = await hmacHex(phonePlain, hmacKey);

  // 不查重：前端已处理合并/去重，服务端做纯存储（INSERT OR REPLACE 支持反复导入）

  // 加密 + 脱敏
  const idCipher = await aesEncrypt(idNumberPlain, aesKey);
  const phoneCipher = await aesEncrypt(phonePlain, aesKey);
  const idMasked = maskIdNumber(idNumberPlain);
  const phoneMasked = maskPhone(phonePlain);

  await migrateLegacyRows(env);

  const retentionUntil = addDays(ACTIVITY_END + 'T23:59:59+08:00', RETENTION_DAYS);

  try {
    await env.DB.prepare(`
      INSERT OR REPLACE INTO records (
        id, role_id, role_name, slot_idx, date, date_label, time, slots,
        category, real_name, id_number, phone, id_hmac, phone_hmac, id_masked, phone_masked,
        platform_id, platform, followers, comp_count, companions, device_id, created_at, retention_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      r.id, r.roleId, r.roleName, r.slotIdx, r.date, r.dateLabel, r.time,
      (Array.isArray(r.slots) ? JSON.stringify(r.slots) : (typeof r.slots === 'string' ? r.slots : null)),
      r.category || '', r.realName, idCipher, phoneCipher, idHmac, phoneHmac, idMasked, phoneMasked,
      r.platformId || '', Array.isArray(r.platform) ? r.platform.join('|') : (r.platform || ''),
      r.followers || '', (Array.isArray(r.companions) ? r.companions.length : 0),
      JSON.stringify(r.companions || []),
      r.deviceId || '', r.createdAt || new Date().toISOString(),
      retentionUntil
    ).run();
  } catch (insertErr) {
    return { error: 'DB insert failed: ' + insertErr.message };
  }

  return { ok: true, id: r.id, retention_until: retentionUntil };
}

/* ============ 加密工具（Web Crypto API）============ */

async function getAesKey(env) {
  if (_aesKeyCache) return _aesKeyCache;
  const secret = (env && env.ID_ENC_KEY) || DEV_ID_ENC_KEY;
  const raw = base64ToBytes(secret);
  // 强制 32 字节（AES-256），不足补 0、超出截断
  const keyBytes = new Uint8Array(32);
  keyBytes.set(raw.slice(0, 32));
  _aesKeyCache = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  );
  return _aesKeyCache;
}

async function getHmacKey(env) {
  if (_hmacKeyCache) return _hmacKeyCache;
  const secret = (env && env.HMAC_KEY) || DEV_HMAC_KEY;
  const raw = base64ToBytes(secret);
  const keyBytes = new Uint8Array(32);
  keyBytes.set(raw.slice(0, 32));
  _hmacKeyCache = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return _hmacKeyCache;
}

async function aesEncrypt(plain, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(String(plain));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);
  return bytesToBase64(combined);
}

async function aesDecrypt(b64, key) {
  const combined = base64ToBytes(b64);
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

async function safeDecrypt(b64, key) {
  try {
    if (!b64) return '';
    return await aesDecrypt(b64, key);
  } catch (e) {
    // 老数据是明文 / 密文损坏，返回原文（兼容迁移期）
    return b64;
  }
}

async function hmacHex(plain, key) {
  const enc = new TextEncoder().encode(String(plain));
  const sig = await crypto.subtle.sign('HMAC', key, enc);
  // 截断为 32 hex 字符（前 16 字节），既足够去重又减少索引体积
  return bytesToHex(new Uint8Array(sig).slice(0, 16));
}

function maskIdNumber(id) {
  if (!id) return '';
  const s = String(id).trim().toUpperCase();
  if (s.length < 8) return '****';
  return s.slice(0, 6) + '********' + s.slice(-4);
}

function maskPhone(p) {
  if (!p) return '';
  const s = String(p);
  if (s.length < 7) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function addDays(isoOrDate, days) {
  const d = new Date(isoOrDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function logAccess(env, request, action, meta) {
  try {
    const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').slice(0, 64);
    const ua = (request.headers.get('user-agent') || '').slice(0, 256);
    const id = 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare(`
      INSERT INTO access_log (id, action, actor_ip, actor_ua, meta, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id, action, ip, ua, JSON.stringify(meta || {}), new Date().toISOString()
    ).run();
  } catch (e) {
    console.error('[access_log] write failed:', e.message);
  }
}

/* 自动迁移：确保表结构完整（幂等）。包含 CREATE TABLE IF NOT EXISTS —— 即使 D1 被意外清空也能自动恢复 */
async function ensureSchema(env) {
  if (!env.DB) return;

  // 主表：records（幂等创建）
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS records (
        id          TEXT PRIMARY KEY,
        role_id     TEXT NOT NULL,
        role_name   TEXT NOT NULL,
        slot_idx    INTEGER NOT NULL,
        date        TEXT NOT NULL,
        date_label  TEXT NOT NULL,
        time        TEXT NOT NULL,
        slots       TEXT,
        category    TEXT,
        real_name   TEXT NOT NULL,
        id_number   TEXT NOT NULL,
        phone       TEXT NOT NULL,
        id_hmac     TEXT,
        phone_hmac  TEXT,
        id_masked   TEXT,
        phone_masked TEXT,
        platform_id TEXT,
        platform    TEXT,
        followers   TEXT,
        comp_count  INTEGER DEFAULT 0,
        companions  TEXT,
        device_id   TEXT,
        created_at  TEXT NOT NULL,
        retention_until TEXT
      )
    `).run();
  } catch (e) {}

  // 旧列迁移（幂等，已存在则跳过）
  const additions = [
    'ALTER TABLE records ADD COLUMN id_hmac TEXT',
    'ALTER TABLE records ADD COLUMN phone_hmac TEXT',
    'ALTER TABLE records ADD COLUMN id_masked TEXT',
    'ALTER TABLE records ADD COLUMN phone_masked TEXT',
    'ALTER TABLE records ADD COLUMN retention_until TEXT',
    'ALTER TABLE records ADD COLUMN slots TEXT',
  ];
  for (const sql of additions) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* 已存在 */ }
  }

  // 索引
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_role_slot ON records(role_id, slot_idx)').run(); } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_id_hmac ON records(id_hmac)').run(); } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_phone_hmac ON records(phone_hmac)').run(); } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC)').run(); } catch (e) {}

  // 签到流水表（visit_log）
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS visit_log (
        id          TEXT PRIMARY KEY,
        record_id   TEXT NOT NULL,
        point       TEXT NOT NULL,
        real_name   TEXT,
        platform_id TEXT,
        time        TEXT NOT NULL
      )
    `).run();
  } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_visit_log_record ON visit_log(record_id)').run(); } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_visit_log_time ON visit_log(time DESC)').run(); } catch (e) {}

  // 审计日志表
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_ip TEXT,
        actor_ua TEXT,
        meta TEXT,
        time TEXT NOT NULL
      )
    `).run();
  } catch (e) {}
  try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(time DESC)').run(); } catch (e) {}
}

/* 老数据迁移：把 id_hmac IS NULL 的行（明文旧数据）批量加密成新格式
 * 用模块级缓存避免每个请求都跑：每个 isolate 只跑一次，幂等 */
let _migrationDone = false;
async function migrateLegacyRows(env) {
  if (_migrationDone || !env.DB) return;
  try {
    const rows = await env.DB.prepare(
      'SELECT id, id_number, phone FROM records WHERE id_hmac IS NULL LIMIT 100'
    ).all();
    const list = rows.results || [];
    if (list.length === 0) { _migrationDone = true; return; }

    const aesKey = await getAesKey(env);
    const hmacKey = await getHmacKey(env);

    for (const row of list) {
      try {
        // 跳过已经是密文的（base64 长度 > 30 且非纯数字）
        const alreadyEncrypted = row.id_number && /[+/=]/.test(row.id_number);
        if (alreadyEncrypted) {
          // 标记为已迁移但不解密（避免误判）
          await env.DB.prepare('UPDATE records SET id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?')
            .bind('', '', maskIdNumber(row.id_number), maskPhone(row.phone), row.id).run();
          continue;
        }
        const idHmac = await hmacHex(row.id_number, hmacKey);
        const phoneHmac = await hmacHex(row.phone, hmacKey);
        const idCipher = await aesEncrypt(row.id_number, aesKey);
        const phoneCipher = await aesEncrypt(row.phone, aesKey);
        const idMasked = maskIdNumber(row.id_number);
        const phoneMasked = maskPhone(row.phone);
        await env.DB.prepare(
          'UPDATE records SET id_number=?, phone=?, id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?'
        ).bind(idCipher, phoneCipher, idHmac, phoneHmac, idMasked, phoneMasked, row.id).run();
        console.log('[migrate] encrypted legacy row', row.id);
      } catch (e) {
        console.error('[migrate] row', row.id, 'failed:', e.message);
      }
    }
    _migrationDone = true;
  } catch (e) {
    console.error('[migrate] error:', e.message);
  }
}

function jsonResp(obj) {
  const status = obj && obj.error ? (obj.error.includes('missing_field') || obj.error.includes('invalid') ? 400 : obj.error.includes('unauthorized') ? 401 : obj.error.includes('duplicate') || obj.error.includes('slot_full') ? 409 : 500) : 200;
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}