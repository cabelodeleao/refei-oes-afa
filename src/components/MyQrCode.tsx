"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

interface Props {
  token: string | null;
  name: string;
  number: string;
}

// Botão flutuante (FAB) "Meu QR": fica fixo no canto inferior direito e, ao
// tocar, abre o QR code em tela cheia para o fiscal ler na entrada do rancho.
export default function MyQrCode({ token, name, number }: Props) {
  const [full, setFull] = useState(false);

  return (
    <>
      {/* Botão flutuante sempre visível */}
      <button
        onClick={() => setFull(true)}
        aria-label="Mostrar meu QR code"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-navy-600 to-navy-800 px-5 py-3.5 font-semibold text-white shadow-lg ring-1 ring-white/10 transition hover:brightness-110 active:scale-95"
      >
        <QrIcon />
        <span className="text-sm">Meu QR</span>
      </button>

      {/* Modal em tela cheia */}
      {full && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6 animate-fade-in"
          onClick={() => setFull(false)}
        >
          <button
            onClick={() => setFull(false)}
            aria-label="Fechar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl text-white backdrop-blur transition hover:bg-white/25"
          >
            ✕
          </button>

          {token ? (
            <div
              className="flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-64 max-w-[82vw] rounded-3xl bg-white p-4 shadow-2xl ring-1 ring-slate-200 animate-scale-in sm:w-72 sm:p-5">
                <QRCode
                  value={token}
                  level="M"
                  className="h-auto w-full"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                />
              </div>
              <p className="mt-5 text-center text-2xl font-bold text-white">
                {name}
              </p>
              <p className="text-base text-white/70">{number}</p>
              <p className="mt-4 max-w-xs text-center text-xs text-white/50">
                Aumente o brilho da tela e mostre este código ao fiscal na
                entrada do rancho.
              </p>
            </div>
          ) : (
            <div
              className="max-w-xs rounded-2xl bg-white p-6 text-center shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-2xl">⚠️</p>
              <p className="mt-2 text-sm font-medium text-slate-700">
                Não foi possível gerar seu QR code. Recarregue a página ou avise
                o administrador.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function QrIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4" />
    </svg>
  );
}
