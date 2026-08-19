/* BK Trans Service Worker (v20.39t)
 * 목적: cold start(잠금 중 프로세스 사망 후 재시작) 때 네트워크가 안 붙어 있어도
 *       크롬 공룡/오류 화면 대신 캐시된 앱 셸(index.html)이 뜨게 한다.
 * 원칙:
 *  - 앱 셸(HTML/manifest/아이콘)만 캐시. 번역 API 요청은 절대 가로채지 않음(항상 실시간).
 *  - 캐시명에 버전을 박아 배포마다 자동 교체(skipWaiting+clients.claim).
 * 이 파일은 index.html 배포 시 함께 갱신할 것. CACHE_VER를 APP_VERSION과 맞춘다.
 * ★p34(2026-07-25 범근님 실사고 — 대기 복귀 흰 화면): 문서 요청에 3초 타임아웃.
 *   복귀 직후 네트워크 스택이 덜 깨어나면 fetch가 실패도 성공도 없이 무한 대기했고,
 *   catch가 안 걸려 캐시 폴백도 못 탔다(새로고침 무효·앱 재시작만 유효했던 이유).
 *   + 쿼리 붙은 URL로 열려도 캐시를 찾도록 ignoreSearch, 캐시 전멸 시 최후 대기화면.
 */
const CACHE_VER = 'v20.57p127';
const CACHE_NAME = 'bktrans-pro-shell-' + CACHE_VER;
const NAV_TIMEOUT_MS = 2500;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/pinyin-pro.js',   // ★p36: CDN에서 자체 호스팅으로 이관(흰화면 진범) — 오프라인도 병음 유지
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) =>
      // 개별 실패가 전체 설치를 막지 않도록 하나씩(실패해도 무시)
      Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // ★p35: 내비게이션 프리로드 — 딥슬립 후 SW 프로세스가 깨어나는 동안에도 브라우저가
    //   문서 요청을 병렬로 먼저 보내게 한다(SW 기동 지연이 첫 화면을 막는 것 방지).
    try { if (self.registration.navigationPreload) await self.registration.navigationPreload.enable(); } catch (_) {}
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('bktrans-pro-shell-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// 프라미스를 ms 안에 못 받으면 reject — 대기 복귀 직후 '무한 대기' 차단용
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('nav-timeout')), ms);
    Promise.resolve(p).then(
      (res) => { clearTimeout(t); resolve(res); },
      (err) => { clearTimeout(t); reject(err); }
    );
  });
}

// 캐시까지 전멸했을 때의 최후 화면 — 흰 화면 대신 자동 재시도 안내
const OFFLINE_HTML = '<!doctype html><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>BK Trans</title>' +
  '<body style="margin:0;font-family:sans-serif;display:flex;min-height:100vh;align-items:center;' +
  'justify-content:center;background:#101014;color:#e8e8ee;text-align:center">' +
  '<div><div style="font-size:44px">⏳</div><p style="line-height:1.7">네트워크 연결을 기다리는 중입니다…<br>' +
  '곧 자동으로 다시 시도합니다.</p></div>' +
  '<script>setTimeout(function(){location.reload()},2500)<\/script>';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET·같은 출처의 문서/정적 자원만 취급. 그 외(API POST 등)는 손대지 않음 → 실시간 번역 보장.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 외부(API 등) 통과

  const isNav = req.mode === 'navigate' || req.destination === 'document';
  e.respondWith((async () => {
    // ★p70(2026-08-01) 내비게이션 캐시우선 — 알림으로 앱을 새로 열 때 셸 다운로드에
    //   1.19~1.52초가 들고 있었다(실측, 539KB). 캐시가 있으면 즉시 띄우고 새 버전은
    //   백그라운드로 받아 다음 실행에 반영한다(기존 controllerchange 자동 새로고침이 흡수).
    //   문서 요청에만 적용하고 그 외 자원은 기존 동작 그대로.
    if (isNav) {
      const cached = await caches.match(req, { ignoreSearch: true })
                  || await caches.match('./index.html');
      if (cached) {
        e.waitUntil((async () => {                 // 백그라운드 갱신
          try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) {
              const c = await caches.open(CACHE_NAME);
              await c.put(req, fresh.clone());
              await c.put('./index.html', fresh.clone());
            }
          } catch (_) {}
        })());
        return cached;
      }
    }
    try {
      // 문서 요청: 프리로드 응답이 있으면 그걸 먼저 쓰고(=SW 기동과 병렬), 없으면 fetch.
      // 어느 쪽이든 시한 안에 안 오면 캐시로 전환(대기 복귀 무한 대기 방지). 그 외 자원은 기존대로.
      const navGet = () => (e.preloadResponse
        ? e.preloadResponse.then((r) => r || fetch(req))
        : fetch(req));
      const res = await (isNav ? withTimeout(navGet(), NAV_TIMEOUT_MS) : fetch(req));
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }
      const hit = await caches.match(req, { ignoreSearch: isNav });
      return hit || res;
    } catch (_) {
      // ignoreSearch: 알림 등으로 쿼리 붙은 URL로 열려도 셸 캐시를 찾는다
      const hit = (await caches.match(req, { ignoreSearch: isNav })) ||
                  (await caches.match('./index.html'));
      if (hit) return hit;
      if (isNav) return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    }
  })());
});
