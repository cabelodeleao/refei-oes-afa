"use client";

import { useEffect, useRef, useState } from "react";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import AdminChangePassword from "../admin/AdminChangePassword";
import Summary from "../admin/Summary";
import { toISODate, startOfWeek, addDays } from "@/lib/dates";

interface Props {
  user: { name: string };
}

const FROM_KEY = "rancho-date-from";
const TO_KEY = "rancho-date-to";

// Painel do Rancho: a MESMA tabela de resumo do admin, porém somente leitura
// (sem aprovar marcações de última hora e sem qualquer outra aba). O intervalo
// de datas começa na semana atual e é lembrado entre as visitas.
export default function RanchoClient({ user }: Props) {
  const week = startOfWeek(new Date());
  const [from, setFrom] = useState(toISODate(week));
  const [to, setTo] = useState(toISODate(addDays(week, 6)));

  // Restaura o último intervalo usado. Fica fora da inicialização do useState
  // (localStorage não existe no servidor) para não divergir na hidratação.
  useEffect(() => {
    try {
      const savedFrom = localStorage.getItem(FROM_KEY);
      const savedTo = localStorage.getItem(TO_KEY);
      if (savedFrom) setFrom(savedFrom);
      if (savedTo) setTo(savedTo);
    } catch {
      /* localStorage indisponível: mantém a semana atual */
    }
  }, []);

  // Salva o intervalo sempre que muda — exceto na primeira renderização, para
  // não sobrescrever o valor guardado antes de ele ser restaurado acima.
  const persistReady = useRef(false);
  useEffect(() => {
    if (!persistReady.current) {
      persistReady.current = true;
      return;
    }
    try {
      localStorage.setItem(FROM_KEY, from);
      localStorage.setItem(TO_KEY, to);
    } catch {
      /* localStorage indisponível: ignora */
    }
  }, [from, to]);

  // Mesma largura do painel do admin: aproveita o desktop sem faixa vazia.
  const container = "mx-auto w-full max-w-[1240px] px-4 sm:px-6";

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 bg-gradient-to-r from-navy-900 to-navy-700 text-white shadow-md">
        <div className={container}>
          <div className="flex items-center justify-between gap-3 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight">
                Painel do Rancho
              </p>
              <p className="text-xs text-blue-100/80">
                {user.name} · somente consulta
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <AdminChangePassword />
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main className={`${container} py-5`}>
        <Summary from={from} to={to} setFrom={setFrom} setTo={setTo} readOnly />
      </main>
    </div>
  );
}
