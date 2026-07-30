export async function onRequestGet(context) {
  const { env } = context;
  return jsonResp(await listRecords(env));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  return jsonResp(await createRecord(request, env));
}

async function listRecords(env) {
  if (!env.DB) return { error: 'DB binding missing', hint: '在 Pages Settings → Functions → D1 database bindings 配置 DB' };
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM records ORDER BY created_at DESC'
    ).all();
    return { records: results || [] };
  } catch (err) {
    return { error: 'DB query failed: ' + err.message };
  }
}

async function createRecord(request, env) {
  if (!env.DB) return { error: 'DB binding missing' };
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

  try {
    await env.DB.prepare(`
      INSERT INTO records (
        id, role_id, role_name, slot_idx, date, date_label, time,
        category, real_name, id_number, phone, platform_id, platform,
        followers, comp_count, companions, device_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      r.id, r.roleId, r.roleName, r.slotIdx, r.date, r.dateLabel, r.time,
      r.category || '', r.realName, String(r.idNumber).toUpperCase(), String(r.phone),
      r.platformId || '', Array.isArray(r.platform) ? r.platform.join('|') : (r.platform || ''),
      r.followers || '', (Array.isArray(r.companions) ? r.companions.length : 0),
      JSON.stringify(r.companions || []),
      r.deviceId || '', r.createdAt || new Date().toISOString()
    ).run();
  } catch (insertErr) {
    return { error: 'DB insert failed: ' + insertErr.message };
  }

  return { ok: true, id: r.id };
}

function jsonResp(obj) {
  const status = obj && obj.error ? (obj.error.includes('missing_field') || obj.error.includes('invalid') ? 400 : obj.error.includes('duplicate') || obj.error.includes('slot_full') ? 409 : 500) : 200;
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
