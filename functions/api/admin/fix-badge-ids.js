/* ============ 修复旧胸卡核销码 ============
 * POST /api/admin/fix-badge-ids
 * 接受 { admin_pin, mappings: [{ platformId, newId }] }
 * 按 platformId 匹配 media 角色，更新 id 为旧核销码
 * ============================================ */

const ADMIN_PIN = '404112';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json200({ error: 'DB binding missing' });

  let body;
  try { body = await request.json(); } catch { return json200({ error: 'invalid json' }); }

  if (!body || body.admin_pin !== ADMIN_PIN) {
    return json200({ error: 'unauthorized' });
  }

  const mappings = body.mappings;
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return json200({ error: 'mappings 不能为空' });
  }

  const results = [];
  for (const m of mappings) {
    const platformId = String(m.platformId || '');
    const newId = String(m.newId || '');
    if (!platformId || !newId) {
      results.push({ platformId, status: 'skip', reason: 'platformId 或 newId 为空' });
      continue;
    }
    try {
      const res = await env.DB.prepare(
        `UPDATE records SET id = ? WHERE platform_id = ? AND role_id = 'media'`
      ).bind(newId, platformId).run();
      // meta.changes 返回受影响行数（CF D1 目前不直接暴露 affected rows，用 success 标志）
      results.push({ platformId, newId, status: 'ok', meta: res.meta });
    } catch (err) {
      results.push({ platformId, newId, status: 'error', reason: err.message });
    }
  }

  // 如果 mappings 长度为 1，也支持用 ?platformId=xxx&newId=yyy 的 GET 快速修复
  return json200({ ok: true, results });
}

// 也支持 GET 快速修复单条
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const adminPin = url.searchParams.get('admin_pin') || '';
  const platformId = url.searchParams.get('platformId') || '';
  const newId = url.searchParams.get('newId') || '';

  if (adminPin !== ADMIN_PIN) return json200({ error: 'unauthorized' });
  if (!platformId || !newId) return json200({ error: '需要 platformId 和 newId 参数' });

  try {
    const res = await env.DB.prepare(
      `UPDATE records SET id = ? WHERE platform_id = ? AND role_id = 'media'`
    ).bind(newId, platformId).run();
    return json200({ ok: true, platformId, newId, meta: res.meta });
  } catch (err) {
    return json200({ error: err.message });
  }
}

function json200(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json;charset=utf-8' },
  });
}
