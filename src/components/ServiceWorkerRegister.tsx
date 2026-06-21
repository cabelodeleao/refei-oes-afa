"use client";

import { useEffect } from "react";

// Registra o service worker (apenas em produção) para acelerar o carregamento
// via cache da shell. Falhas são silenciosas — o app funciona sem o SW.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignora: o SW é uma otimização opcional */
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
