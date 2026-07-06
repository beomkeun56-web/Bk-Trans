/* BK Trans Service Worker (v20.39t)
 * 목적: cold start(잠금 중 프로세스 사망 후 재시작) 때 네트워크가 안 붙어 있어도
 *       크롬 공룡/오류 화면 대신 캐시된 앱 셸(index.html)이 뜨게 한다.
 * 원칙:
 *  - 앱 셸(HTML/manifest/아이콘)만 캐시. 번역 API 요청은 절대 가로채지 않음(항상 실시간).
 *  - 캐시명에 버전을 박아 배포마다 자동 교체(skipWaiting+clients.claim).
 * 이 파일은 index.html 배포 시 함께 갱신할 것. CACHE_VER를 APP_VERSION과 맞춘다.
 */
const CACHE_VER = 'v20.39t';
const CACHE_NAME = 'bk-trans-shell-' + CACHE_VER;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
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
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('bk-trans-shell-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET·같은 출처의 문서/정적 자원만 취급. 그 외(API POST 등)는 손대지 않음 → 실시간 번역 보장.
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // 외부(API 등) 통과

  // 네트워크 우선, 실패 시 캐시 폴백(=cold start 오프라인일 때 앱 셸 제공).
  // 성공하면 최신본을 캐시에 갱신(다음 오프라인 대비).
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
