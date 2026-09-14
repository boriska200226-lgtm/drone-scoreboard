/* Service Worker «Гильдии».
 *
 * Что он обязан уметь по ТЗ (§6):
 *   — держать HTML/CSS/JS в кэше 7 дней;
 *   — в офлайне показывать последнюю загруженную страницу;
 *   — не мешать установке приложения на телефон и ноутбук.
 *
 * Чего он не делает: не кэширует ничего с чужих доменов и ни одного
 * изменяющего запроса. Живые данные приходят по WebSocket, кэш нужен
 * только чтобы приложение открылось без сети.
 */
const VERSION = 'guild-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const DATA_CACHE = `${VERSION}-data`;

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const STAMP_HEADER = 'x-guild-cached-at';

const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/guild-icon-192.png', '/guild-icon-512.png'];

// Состояние класса читаем из кэша, когда сети нет: лучше показать
// вчерашний Алтарь с пометкой «офлайн», чем пустой экран.
const CACHEABLE_API = ['/api/guild/state', '/api/guild/rules'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function stamp(response) {
  // Отдельный заголовок с временем записи: у ответа из кэша нет
  // собственного «возраста», а протухание считать надо.
  const headers = new Headers(response.headers);
  headers.set(STAMP_HEADER, String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isFresh(response, maxAge) {
  const cachedAt = Number(response.headers.get(STAMP_HEADER) || 0);
  return cachedAt > 0 && Date.now() - cachedAt < maxAge;
}

async function cachePut(cacheName, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, stamp(response.clone()));
  return response;
}

// Навигация: сначала сеть, при её отсутствии — последняя виденная страница.
async function handleNavigation(request) {
  try {
    const fresh = await fetch(request);
    await cachePut(SHELL_CACHE, '/index.html', fresh.clone());
    return fresh;
  } catch (err) {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('/index.html'))
      || (await cache.match('/'))
      || new Response(
        '<!doctype html><meta charset="utf-8"><title>Гильдия — офлайн</title>'
        + '<body style="background:#0a0d14;color:#e8f5ee;font:16px/1.5 system-ui;'
        + 'display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
        + '<div><h1>Нет сети</h1><p>Гильдия откроется, как только появится связь.</p></div>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
  }
}

// Статика: отдаём из кэша, пока ей меньше 7 дней, и обновляем в фоне.
async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => cachePut(ASSET_CACHE, request, response))
    .catch(() => undefined);
  if (cached && isFresh(cached, SEVEN_DAYS)) return cached;
  return (await update) || cached || fetch(request);
}

async function handleData(request) {
  try {
    const fresh = await fetch(request);
    await cachePut(DATA_CACHE, request, fresh.clone());
    return fresh;
  } catch (err) {
    const cache = await caches.open(DATA_CACHE);
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('x-guild-offline', '1');
      return new Response(cached.body, { status: cached.status, headers });
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // чужие домены не трогаем

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (CACHEABLE_API.some((path) => url.pathname === path)) {
    event.respondWith(handleData(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) return;      // всё остальное — только по сети

  if (['script', 'style', 'font', 'image'].includes(request.destination)) {
    event.respondWith(handleAsset(request));
  }
});
