"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import ManageMeals from "./ManageMeals";
import Summary from "./Summary";
import MenuManager from "./MenuManager";
import Cadets from "./Cadets";
import { toISODate, startOfWeek, addDays } from "@/lib/dates";

interface Props {
  user: { name: string; number: string };
}

type Tab = "gerenciar" | "resumo" | "cardapio" | "cadetes";

function parseTab(v: string | null): Tab {
  if (v === "resumo" || v === "cardapio" || v === "cadetes") return v;
  return "gerenciar";
}

export default function AdminClient({ user }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Período padrão: semana atual (segunda a domingo).
  const week = startOfWeek(new Date());
  const defaultFrom = toISODate(week);
  const defaultTo = toISODate(addDays(week, 6));

  // Valores iniciais lidos da URL (?tab=&from=&to=), com fallback.
  const [tab, setTab] = useState<Tab>(parseTab(searchParams.get("tab")));
  const [from, setFrom] = useState(searchParams.get("from") || defaultFrom);
  const [to, setTo] = useState(searchParams.get("to") || defaultTo);

  // Mantém a URL sincronizada sem recarregar a página (navegação shallow).
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    params.set("from", from);
    params.set("to", to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [tab, from, to, pathname, router]);

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 bg-gradient-to-r from-navy-900 to-navy-700 text-white shadow-md">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center justify-between gap-3 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-base font-bold leading-tight">
                Painel do Administrador
              </p>
              <p className="text-xs text-blue-100/80">{user.name}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <LogoutButton />
            </div>
          </div>
          <nav className="flex gap-1">
            <TabButton
              active={tab === "gerenciar"}
              onClick={() => setTab("gerenciar")}
            >
              Gerenciar Refeições
            </TabButton>
            <TabButton active={tab === "resumo"} onClick={() => setTab("resumo")}>
              Resumo
            </TabButton>
            <TabButton
              active={tab === "cardapio"}
              onClick={() => setTab("cardapio")}
            >
              Cardápio
            </TabButton>
            <TabButton
              active={tab === "cadetes"}
              onClick={() => setTab("cadetes")}
            >
              Cadetes
            </TabButton>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {tab === "gerenciar" ? (
          <ManageMeals from={from} to={to} setFrom={setFrom} setTo={setTo} />
        ) : tab === "resumo" ? (
          <Summary from={from} to={to} setFrom={setFrom} setTo={setTo} />
        ) : tab === "cardapio" ? (
          <MenuManager />
        ) : (
          <Cadets />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "bg-slate-100 text-navy-800 dark:bg-gray-900 dark:text-gray-100"
          : "text-blue-100/80 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
