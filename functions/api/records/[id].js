// Pages Function: DELETE /api/records/<id>
// 也支持 POST /api/records/<id>/checkin（带旧 ID 别名兼容）
export async function onRequestDelete(context) {
  const { env, params } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  const id = decodeURIComponent(params.id);

  // 先删关联的签到流水
  await env.DB.prepare('DELETE FROM visit_log WHERE rid = ?').bind(id).run();
  const r = await env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
  if (r.meta && r.meta.changes === 0) return json({ error: 'not_found' }, 404);
  return json({ ok: true, deleted: id });
}

/**
 * 解析传入的 id：先用 records.id 查，没有再走 record_id_aliases 兼容旧胸卡核销码
 * 返回最终 records.id（用于后续操作）
 */
async function resolveRecordId(env, rawId) {
  // 1. 直接命中
  const direct = await env.DB.prepare('SELECT id FROM records WHERE id = ?').bind(rawId).first();
  if (direct) return direct.id;

  // 2. 别名命中 → 通过 platform_id 找到真实记录
  const alias = await env.DB.prepare(
    "SELECT platform_id, role_id FROM record_id_aliases WHERE alias_id = ?"
  ).bind(rawId).first();
  if (!alias) return null;
  const real = await env.DB.prepare(
    "SELECT id FROM records WHERE platform_id = ? AND role_id = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(alias.platform_id, alias.role_id).first();
  return real ? real.id : null;
}

const POINT_ALIASES = {
  'hs6phev': '垂直窄位',
  'hs6p hev': '垂直窄位',
};
export async function onRequestPost(context) {
  // POST /api/records/<id>/checkin - 给某条报名打一个签到点
  const { env, params, request } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  await ensureAliases(env);

  const rawRid = decodeURIComponent(params.id);
  const body = await request.json().catch(() => ({}));

  // 解析真实记录 ID（兼容旧核销码）
  const resolvedId = await resolveRecordId(env, rawRid);
  if (!resolvedId) return json({ error: 'record_not_found', hint: '该编号既不在 records 表也不在 id 别名表中' }, 404);

  const point = POINT_ALIASES[body.point] || body.point || '';
  const id = 'vl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare(`
    INSERT INTO visit_log (id, rid, point, operator, note, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id, resolvedId, point, body.operator || '', body.note || '',
    body.time || new Date().toISOString()
  ).run();
  return json({ ok: true, id, resolved_id: resolvedId, original_id: rawRid });
}

// 兼容旧 visit_log schema 用，记录现场偶尔有别的入口直接 POST 旧核销码（保留兜底）
async function ensureAliases(env) {
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS record_id_aliases (
        alias_id    TEXT PRIMARY KEY,
        platform_id TEXT NOT NULL,
        role_id     TEXT NOT NULL DEFAULT 'media',
        note        TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
      )
    `).run();
  } catch (e) {}

  const legacySeeds = [
    ['962386', '越玩越野', 'media'],
    ['953619', '车事纪',   'media'],
    ['879168', '李书尧',   'media'],
    ['295861', '穆杉车话', 'media'],
    ['625064', '玩车报告', 'media'],
    ['648247', '科技公元', 'media'],
  ];
  for (const [aliasId, platformId, roleId] of legacySeeds) {
    try {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO record_id_aliases (alias_id, platform_id, role_id, note) VALUES (?, ?, ?, ?)'
      ).bind(aliasId, platformId, roleId, '2026-08-10 旧胸卡').run();
    } catch (e) {}
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
