/* Service worker básico — Refeições AFA.
   Objetivo: carregamento rápido via cache da shell estática. NÃO faz cache de
   respostas de API nem de páginas dinâmicas (sempre rede para dados frescos). */

const CACHE = "refeicoes-afa-v1";
const SHELL = ["/", "/manifest.json", "/icon-192.svg", "/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Só lida com GET de mesma origem.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Nunca cacheia API nem navegação de páginas (dados precisam estar frescos).
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") return;

  // Assets estáticos (_next/static, ícones, manifest): cache-first.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    SHELL.includes(url.pathname) ||
    /\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/.test(url.pathname);
  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
