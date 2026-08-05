// Pages Function: DELETE /api/records/<id>
// 也支持 POST /api/records/<id>/checkin
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

export async function onRequestPost(context) {
  // POST /api/records/<id>/checkin - 给某条报名打一个签到点
  const { env, params, request } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  const rid = decodeURIComponent(params.id);
  const body = await request.json().catch(() => ({}));
  const rec = await env.DB.prepare('SELECT id FROM records WHERE id = ?').bind(rid).first();
  if (!rec) return json({ error: 'record_not_found' }, 404);

  const id = 'vl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare(`
    INSERT INTO visit_log (id, rid, point, operator, note, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id, rid, body.point || '', body.operator || '', body.note || '',
    new Date().toISOString()
  ).run();
  return json({ ok: true, id });
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