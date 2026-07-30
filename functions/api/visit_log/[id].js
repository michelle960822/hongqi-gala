// Pages Function: DELETE /api/visit_log/<id>
export async function onRequestDelete(context) {
  const { env, params } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  const id = decodeURIComponent(params.id);
  const r = await env.DB.prepare('DELETE FROM visit_log WHERE id = ?').bind(id).run();
  if (r.meta && r.meta.changes === 0) return json({ error: 'not_found' }, 404);
  return json({ ok: true, deleted: id });
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