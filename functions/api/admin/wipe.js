// Pages Function: POST /api/admin/wipe
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  const body = await request.json().catch(() => ({}));
  if (body.adminPin !== '404112') return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM visit_log').run();
  await env.DB.prepare('DELETE FROM records').run();
  return json({ ok: true, message: '已清空所有数据' });
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