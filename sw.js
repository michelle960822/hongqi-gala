/* Service Worker — 粉丝家年华报名小程序 v4
 * 策略：network-first（HTML/JS 永远拿最新），network-fail 时 fallback 到 cache
 * cache 名称：fan-signup-v4（升级会清掉旧缓存）
 * 注意：API 请求走 Workers 跨域，不会被本 SW 拦截，由前端 fetch 直接处理
 */
const CACHE_NAME = 'fan-signup-v4';
const ASSETS = [
  './',
  './index.html',
  './jsQR.js',
  './sw.js',
];

self.addEventListener('install', (e) => {
  // 跳过等待，立刻激活新 SW（旧的会被 activate 事件清理）
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // 清掉所有旧版本缓存
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  // 策略：network-first（HTML/JS 优先拿最新）
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        // 网络请求成功 → 更新缓存 + 返回
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => {
        // 离线 → fallback 到缓存
        return caches.match(e.request).then((cached) => {
          if (cached) return cached;
          // 都没有 → 返回根页面（让 SPA 接管）
          if (e.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504 });
        });
      })
  );
});
