// 临时 debug 端点：返回 records 表原始数据（用于排查 AES 迁移问题）
export async function onRequestGet(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  const url = new URL(request.url);
  if (url.searchParams.get('pin') !== '404112') return json({ error: 'unauthorized' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT id, id_number, phone, id_hmac, phone_hmac, id_masked, phone_masked FROM records'
  ).all();

  return json({ rows: results || [] }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}