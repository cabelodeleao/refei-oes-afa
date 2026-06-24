"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

interface Props {
  token: string | null;
  name: string;
  number: string;
}

// Botão flutuante (FAB) "Meu QR" + modal (sheet escuro) com o QR em moldura
// branca, no estilo do design de referência.
export default function MyQrCode({ token, name, number }: Props) {
  const [full, setFull] = useState(false);

  return (
    <>
      <button
        className="cad-fab"
        onClick={() => setFull(true)}
        aria-label="Mostrar meu QR code"
      >
        <QrIcon />
        Meu QR
      </button>

      {full && (
        <div className="cad-overlay" onClick={() => setFull(false)}>
          <div
            className="cad-sheet cad-qr-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-sm font-semibold"
                style={{ fontFamily: "var(--font-sora), Sora, sans-serif" }}
              >
                Meu QR
              </span>
              <button
                className="cad-x"
                onClick={() => setFull(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {token ? (
              <>
                <div className="cad-qr-frame">
                  <QRCode
                    value={token}
                    level="M"
                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                  />
                </div>
                <p
                  className="mt-5 text-xl font-bold"
                  style={{ fontFamily: "var(--font-sora), Sora, sans-serif" }}
                >
                  {name}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: "#8b97a8" }}>
                  {number}
                </p>
                <p
                  className="mx-auto mt-4 max-w-[16rem] text-xs leading-relaxed"
                  style={{ color: "#6b7688" }}
                >
                  Aumente o brilho da tela e mostre este código ao fiscal na
                  entrada do rancho.
                </p>
              </>
            ) : (
              <p className="mt-6 text-sm" style={{ color: "#ff9a9a" }}>
                Não foi possível gerar seu QR code. Recarregue a página ou avise
                o administrador.
              </p>
            )}
          </div>
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
