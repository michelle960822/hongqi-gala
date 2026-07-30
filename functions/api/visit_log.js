export async function onRequestGet(context) {
  const { env } = context;
  if (!env.DB) return r({ error: 'DB binding missing' }, 500);
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM visit_log ORDER BY time DESC'
    ).all();
    return r({ visitLog: results || [] });
  } catch (err) {
    return r({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return r({ error: 'DB binding missing' }, 500);
  let v;
  try { v = await request.json(); } catch { return r({ error: 'invalid json' }, 400); }
  if (!v || !v.rid || !v.time) return r({ error: 'missing fields (rid, time)' }, 400);
  const id = v.id || ('vl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  try {
    await env.DB.prepare(`
      INSERT INTO visit_log (id, rid, point, operator, note, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, v.rid, v.point || '', v.operator || '', v.note || '', v.time).run();
  } catch (err) {
    return r({ error: err.message }, 500);
  }
  return r({ ok: true, id });
}

function r(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
