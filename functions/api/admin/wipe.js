// Pages Function: POST /api/admin/wipe
// 模式：
//   { mode: 'all',     adminPin }  → 清空全部数据（应急）
//   { mode: 'expired', adminPin }  → 清理 retention_until < 今天的记录（含关联 visit_log）

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const body = await request.json().catch(() => ({}));
  const pin = body.adminPin || '';
  if (pin !== '404112') return json({ error: 'unauthorized' }, 401);

  // 兜底：保证 access_log 表存在（即便 records.js 还没被调用过）
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_ip TEXT, actor_ua TEXT, meta TEXT, time TEXT NOT NULL
      )
    `).run();
  } catch (e) {}

  const mode = body.mode || 'all';

  // 写访问日志
  const ip = (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '').slice(0, 64);
  const ua = (request.headers.get('user-agent') || '').slice(0, 256);
  const logId = 'al_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const logAction = mode === 'expired' ? 'admin_cleanup_expired' : 'admin_wipe_all';

  try {
    if (mode === 'expired') {
      const today = new Date().toISOString().slice(0, 10);
      // 先删关联流水
      const expiredRecords = await env.DB.prepare(
        'SELECT id FROM records WHERE retention_until IS NOT NULL AND retention_until < ?'
      ).bind(today).all();
      const expiredIds = (expiredRecords.results || []).map(r => r.id);

      if (expiredIds.length === 0) {
        await writeLog(env, logId, logAction, ip, ua, { deleted: 0, today });
        return json({ ok: true, deleted: 0, message: '没有需要清理的过期数据' });
      }

      // 分批删除占位 ? 用 IN (...)
      const placeholders = expiredIds.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM visit_log WHERE rid IN (${placeholders})`).bind(...expiredIds).run();
      const delRes = await env.DB.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).bind(...expiredIds).run();

      await writeLog(env, logId, logAction, ip, ua, { deleted: expiredIds.length, today });

      return json({
        ok: true,
        deleted: expiredIds.length,
        message: `已清理 ${expiredIds.length} 条到期记录及关联签到流水`
      });
    }

    // 默认 mode=all：清空全部
    await env.DB.prepare('DELETE FROM visit_log').run();
    await env.DB.prepare('DELETE FROM records').run();
    await writeLog(env, logId, logAction, ip, ua, { deleted: 'all' });

    return json({ ok: true, message: '已清空所有数据' });
  } catch (err) {
    return json({ error: 'cleanup failed: ' + err.message }, 500);
  }
}

async function writeLog(env, id, action, ip, ua, meta) {
  try {
    await env.DB.prepare(
      'INSERT INTO access_log (id, action, actor_ip, actor_ua, meta, time) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, action, ip, ua, JSON.stringify(meta || {}), new Date().toISOString()).run();
  } catch (e) {
    console.error('[access_log] write failed:', e.message);
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