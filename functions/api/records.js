/* ============ 红旗粉丝家年华 · 报名记录 API ============
 * 隐私保护要点：
 * - 列表接口默认返回脱敏后的身份证/手机号（110101********1234 / 138****5678）
 * - ?full=1 + 正确 admin_pin 才返回明文，同时写入 access_log 用于审计
 * - 新增记录时自动写入 retention_until（活动结束 + 30 天），到期由管理员触发清理
 * ======================================================= */

const ADMIN_PIN_DEFAULT = '404112';
const ACTIVITY_END = '2026-08-15';
const RETENTION_DAYS = 30;

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

  const url = new URL(request.url);
  const wantFull = url.searchParams.get('full') === '1';
  const adminPin = url.searchParams.get('admin_pin') || '';

  // 仅管理员 PIN 可拉明文
  if (wantFull && adminPin !== ADMIN_PIN_DEFAULT) {
    return { error: 'unauthorized', hint: '需要管理员 PIN 才能查看完整数据' };
  }

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM records ORDER BY created_at DESC'
    ).all();
    let records = results || [];

    // 默认脱敏
    if (!wantFull) {
      records = records.map(r => ({
        ...r,
        id_number: maskIdNumber(r.id_number),
        phone: maskPhone(r.phone),
      }));
    } else {
      // 写访问日志（含条数与 IP/UA）
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

  // 身份证去重
  const dupId = await env.DB.prepare(
    'SELECT id, real_name, date_label, time FROM records WHERE id_number = ? LIMIT 1'
  ).bind(String(r.idNumber).toUpperCase()).first();
  if (dupId) {
    return {
      error: 'duplicate_id',
      message: `该身份证号已报名：${dupId.real_name}（${dupId.date_label} ${dupId.time}）`
    };
  }

  // 手机号去重
  const dupPhone = await env.DB.prepare(
    'SELECT id, real_name, date_label, time FROM records WHERE phone = ? LIMIT 1'
  ).bind(String(r.phone)).first();
  if (dupPhone) {
    return {
      error: 'duplicate_phone',
      message: `该手机号已报名：${dupPhone.real_name}（${dupPhone.date_label} ${dupPhone.time}）`
    };
  }

  // 容量检查
  const roleSlots = {
    anchor: [25, 25, 25, 25],
    talent: [25, 25, 30],
    media:  [25, 25, 25, 25, 25, 25, 25, 25],
  };
  const cap = (roleSlots[r.roleId] && roleSlots[r.roleId][r.slotIdx]) || 25;
  const used = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM records WHERE role_id = ? AND slot_idx = ?'
  ).bind(r.roleId, r.slotIdx).first();
  if (used && used.n >= cap) {
    return { error: 'slot_full', message: `该时段已报满（${cap}/${cap}）` };
  }

  // 留存期限：活动结束 + 30 天
  const retentionUntil = addDays(ACTIVITY_END + 'T23:59:59+08:00', RETENTION_DAYS);

  try {
    await env.DB.prepare(`
      INSERT INTO records (
        id, role_id, role_name, slot_idx, date, date_label, time,
        category, real_name, id_number, phone, platform_id, platform,
        followers, comp_count, companions, device_id, created_at, retention_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      r.id, r.roleId, r.roleName, r.slotIdx, r.date, r.dateLabel, r.time,
      r.category || '', r.realName, String(r.idNumber).toUpperCase(), String(r.phone),
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

/* ============ 工具函数 ============ */

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
    // 日志失败不阻断主流程
    console.error('[access_log] write failed:', e.message);
  }
}

/* 自动迁移：第一次访问时给老库加上 retention_until 字段和 access_log 表（幂等） */
async function ensureSchema(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare('ALTER TABLE records ADD COLUMN retention_until TEXT').run();
  } catch (e) { /* duplicate column 已存在 */ }
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
  } catch (e) { /* 已存在 */ }
  try {
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(time DESC)').run();
  } catch (e) { /* 已存在 */ }
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