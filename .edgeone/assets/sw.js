/* Service Worker — 粉丝家年华报名小程序 v5
 * 策略：HTML/JS/CSS 走 network-first（拿最新），API 请求完全跳过 SW
 * 重要修复：之前 SW 拦截了 /api/* 并缓存，导致手机端永远看到旧数据
 * cache 名称：fan-signup-v5
 */
const CACHE_NAME = 'fan-signup-v5';
const ASSETS = [
  './',
  './index.html',
  './jsQR.js',
  './sw.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // 清掉所有旧版本缓存（包括 v4、v3 等）
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 关键修复 1：只处理同源 GET 请求
  if (url.origin !== self.location.origin) return;

  // 关键修复 2：API 请求（/api/*）完全跳过 SW，由前端 fetch 直连云函数
  // 否则 SW 会缓存 API 响应，导致手机端永远看到旧数据
  if (url.pathname.startsWith('/api/')) return;

  // 其他静态资源：network-first（拿最新），失败 fallback 到 cache
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => {
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          if (e.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504 });
        });
      })
  );
});