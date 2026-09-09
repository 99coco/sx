/* ============================================================
   尚学教育 PWA Service Worker
   - 缓存策略（关键：本系统前端迭代频繁，绝不能让用户卡在旧版）：
     1) 页面导航 index.html  → network-first（联网永远拿最新，断网回退缓存）
     2) 静态资源 js/css/字体/图标 → stale-while-revalidate（秒开 + 后台更新）
        assets 文件名带内容 hash，天然无缓存污染
     3) /api/* 与跨域请求 → 一律直连不缓存（业务数据必须实时）
   - 版本号变更请同步 SW 名称里的 vN，activate 时自动清旧缓存
   ============================================================ */
const ASSET_CACHE = 'sx-assets-v1';
const SHELL_CACHE = 'sx-shell-v1';
const MAX_ASSETS = 260;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== ASSET_CACHE && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域(如 MathJax CDN)不接管
  const path = url.pathname;

  // 业务接口一律直连
  if (path.startsWith('/api/')) return;

  // 页面导航：network-first
  if (req.mode === 'navigate') {
    e.respondWith(networkFirstShell(req));
    return;
  }

  // 静态资源：stale-while-revalidate
  if (
    path === '/index.html' ||
    path === '/manifest.json' ||
    path === '/sw.js' ||
    path.startsWith('/icons/') ||
    /\.(?:js|css|woff2?|ttf|eot|png|jpe?g|svg|webp)$/i.test(path)
  ) {
    e.respondWith(swr(req));
    return;
  }

  // 其它同源 GET（如上传文件等）不缓存，直连
});

async function networkFirstShell(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', copy);
    }
    return res;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match('/index.html');
    if (hit) return hit;
    return new Response('尚学教育：当前离线，请联网后重试', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function swr(req) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        cache.put(req, res.clone());
        prune(cache);
      }
      return res;
    })
    .catch(() => cached);
  return cached || (await fetchPromise);
}

async function prune(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_ASSETS) {
      // Cache API keys 按插入顺序排列，删最旧的
      await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
    }
  } catch (e) {
    /* 忽略修剪失败 */
  }
}
