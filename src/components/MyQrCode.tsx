"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

interface Props {
  token: string | null;
  name: string;
  number: string;
}

// Seção "Meu QR Code" do cadete: mostra o QR gerado a partir do token secreto
// e permite ampliá-lo em tela cheia para facilitar a leitura pelo fiscal.
export default function MyQrCode({ token, name, number }: Props) {
  const [full, setFull] = useState(false);

  if (!token) {
    return (
      <section className="card p-5">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          📱 Meu QR Code
        </h2>
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          Não foi possível gerar seu QR code. Recarregue a página ou avise o
          administrador.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card p-5">
        <h2 className="font-bold text-navy-800 dark:text-gray-100">
          📱 Meu QR Code
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-gray-400">
          Mostre este código ao fiscal na entrada do rancho.
        </p>
        <div className="flex flex-col items-center">
          <button
            onClick={() => setFull(true)}
            className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition active:scale-95"
            aria-label="Ampliar QR code"
          >
            <QRCode value={token} size={200} level="M" />
          </button>
          <p className="mt-3 text-center font-semibold text-slate-700 dark:text-gray-200">
            {name}
          </p>
          <p className="text-sm text-slate-500 dark:text-gray-400">{number}</p>
          <button
            onClick={() => setFull(true)}
            className="btn-secondary mt-3 px-4 py-1.5 text-xs"
          >
            🔍 Ampliar em tela cheia
          </button>
        </div>
      </section>

      {full && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6"
          onClick={() => setFull(false)}
        >
          <div className="rounded-3xl bg-white p-5 ring-1 ring-slate-200">
            <QRCode value={token} size={300} level="M" />
          </div>
          <p className="mt-5 text-center text-xl font-bold text-slate-900">
            {name}
          </p>
          <p className="text-base text-slate-600">{number}</p>
          <button
            onClick={() => setFull(false)}
            className="mt-8 rounded-xl bg-navy-700 px-6 py-2.5 font-semibold text-white"
          >
            Fechar
          </button>
        </div>
      )}
    </>
  );
}
