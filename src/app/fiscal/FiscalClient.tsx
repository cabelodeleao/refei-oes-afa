"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import LogoutButton from "@/components/LogoutButton";
import ThemeToggle from "@/components/ThemeToggle";
import { apiFetch } from "@/lib/client";
import { MEAL_LABELS, type MealType } from "@/lib/constants";
import { formatLongDate } from "@/lib/dates";

interface Slot {
  id: string;
  date: string;
  meal_type: MealType;
  entered: number;
}

type ScanStatus = "autorizado" | "negado" | "ja_registrado" | "invalido";

interface ScanResult {
  status: ScanStatus;
  cadet?: { name: string; number: string; squadron_label: string };
  entered_at?: string | null;
  reason?: string;
  attempt_id?: string | null;
}

// Alvo de anotação de fraude: uma leitura duplicada (amarela) que o fiscal
// pode marcar com a pessoa real que está usando o QR alheio.
interface FlagTarget {
  attemptId: string;
  ownerName: string;
  ownerNumber: string;
}

interface RecentItem {
  key: number;
  status: ScanStatus;
  name: string;
  number: string;
  time: string;
}

const RESULT_MS = 2600; // tempo que o resultado fica em destaque antes de voltar

function hhmm(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Beep simples via WebAudio (sem arquivos). freq alta = sucesso, baixa = erro.
function beep(kind: "ok" | "warn" | "err") {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freq = kind === "ok" ? 880 : kind === "warn" ? 600 : 300;
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
    osc.onended = () => ctx.close();
  } catch {
    /* áudio indisponível: ignora */
  }
}

const STATUS_UI: Record<
  ScanStatus,
  { bg: string; label: string; icon: string }
> = {
  autorizado: { bg: "bg-emerald-500", label: "AUTORIZADO", icon: "✓" },
  negado: { bg: "bg-red-600", label: "NÃO MARCOU ESTA REFEIÇÃO", icon: "✗" },
  ja_registrado: { bg: "bg-amber-500", label: "JÁ REGISTRADO", icon: "⚠" },
  invalido: { bg: "bg-slate-600", label: "QR INVÁLIDO", icon: "?" },
};

export default function FiscalClient({ user }: { user: { name: string } }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotId, setSlotId] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // Anotação de fraude de QR (leitura duplicada).
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);
  const [flagPerson, setFlagPerson] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagDone, setFlagDone] = useState(false);
  const [flagError, setFlagError] = useState("");

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false); // ignora leituras enquanto um resultado é exibido
  const resultTimer = useRef<ReturnType<typeof setTimeout>>();
  const seqRef = useRef(0);
  const slotIdRef = useRef("");

  useEffect(() => {
    slotIdRef.current = slotId;
  }, [slotId]);

  // Carrega as refeições do dia.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/fiscal/slots");
        const data = await res.json();
        if (res.ok) setSlots(data.slots ?? []);
      } finally {
        setLoadingSlots(false);
      }
    })();
  }, []);

  // Ao escolher a refeição, inicializa o contador com o total já registrado.
  function selectSlot(id: string) {
    setSlotId(id);
    const s = slots.find((x) => x.id === id);
    setCount(s?.entered ?? 0);
    setRecent([]);
    setFlagTarget(null);
  }

  const stopScanner = useCallback(async () => {
    const sc = scannerRef.current;
    scannerRef.current = null;
    if (sc) {
      try {
        await sc.stop();
        sc.clear();
      } catch {
        /* já parado */
      }
    }
  }, []);

  // Para a câmera ao desmontar.
  useEffect(() => {
    return () => {
      clearTimeout(resultTimer.current);
      void stopScanner();
    };
  }, [stopScanner]);

  async function processScan(token: string) {
    const currentSlot = slotIdRef.current;
    if (!currentSlot) return;
    try {
      const res = await apiFetch("/api/fiscal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr_token: token, slot_id: currentSlot }),
      });
      const data: ScanResult = await res.json();
      if (!res.ok || !data.status) {
        setResult({ status: "invalido", reason: "Erro na leitura" });
        beep("err");
      } else {
        setResult(data);
        if (data.status === "autorizado") {
          beep("ok");
          setCount((c) => c + 1);
        } else if (data.status === "ja_registrado") {
          beep("warn");
          // Abre o painel p/ anotar quem está usando o QR alheio (fraude).
          if (data.attempt_id && data.cadet) {
            setFlagTarget({
              attemptId: data.attempt_id,
              ownerName: data.cadet.name,
              ownerNumber: data.cadet.number,
            });
            setFlagPerson("");
            setFlagNote("");
            setFlagDone(false);
            setFlagError("");
          }
        } else {
          beep("err");
        }
        if (data.cadet) {
          const item: RecentItem = {
            key: ++seqRef.current,
            status: data.status,
            name: data.cadet.name,
            number: data.cadet.number,
            time: hhmm(data.entered_at) || hhmm(new Date().toISOString()),
          };
          setRecent((r) => [item, ...r].slice(0, 20));
        }
      }
    } catch {
      setResult({ status: "invalido", reason: "Erro de conexão" });
      beep("err");
    }

    // Mantém o resultado visível por alguns segundos e volta a escanear.
    clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => {
      setResult(null);
      busyRef.current = false;
      try {
        scannerRef.current?.resume();
      } catch {
        /* ignore */
      }
    }, RESULT_MS);
  }

  async function startScanner() {
    setCamError("");
    if (!slotId) {
      setCamError("Selecione a refeição antes de iniciar a leitura.");
      return;
    }
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decoded) => {
          if (busyRef.current) return;
          busyRef.current = true;
          try {
            scannerRef.current?.pause(true);
          } catch {
            /* ignore */
          }
          void processScan(decoded.trim());
        },
        () => {
          /* leitura sem QR no quadro: ignora silenciosamente */
        }
      );
    } catch (err) {
      setScanning(false);
      scannerRef.current = null;
      setCamError(
        "Não foi possível acessar a câmera. Verifique a permissão no navegador."
      );
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }

  async function stopScanning() {
    clearTimeout(resultTimer.current);
    setResult(null);
    setFlagTarget(null);
    busyRef.current = false;
    await stopScanner();
    setScanning(false);
  }

  async function submitFlag() {
    if (!flagTarget) return;
    if (!flagPerson.trim() && !flagNote.trim()) {
      setFlagError("Informe quem está usando o QR ou uma observação.");
      return;
    }
    setFlagBusy(true);
    setFlagError("");
    try {
      const res = await apiFetch(`/api/fiscal/scan/${flagTarget.attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flagged_person: flagPerson,
          fiscal_note: flagNote,
        }),
      });
      if (res.ok) {
        setFlagDone(true);
      } else {
        const data = await res.json().catch(() => null);
        setFlagError(data?.error ?? "Não foi possível registrar.");
      }
    } catch {
      setFlagError("Erro de conexão.");
    } finally {
      setFlagBusy(false);
    }
  }

  const selectedSlot = slots.find((s) => s.id === slotId);
  const ui = result ? STATUS_UI[result.status] : null;

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-navy-900 to-navy-700 text-white shadow-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight">
              Fiscalização do Rancho
            </p>
            <p className="text-xs text-blue-100/80">{user.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {/* Seletor de refeição */}
        <section className="card p-5">
          <label className="mb-1.5 block text-sm font-semibold text-navy-800 dark:text-gray-100">
            Refeição fiscalizada
          </label>
          {loadingSlots ? (
            <p className="text-sm text-slate-400">Carregando refeições…</p>
          ) : slots.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-gray-400">
              Nenhuma refeição cadastrada para hoje.
            </p>
          ) : (
            <select
              className="input"
              value={slotId}
              onChange={(e) => selectSlot(e.target.value)}
              disabled={scanning}
            >
              <option value="">Selecione…</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {MEAL_LABELS[s.meal_type]} — {formatLongDate(s.date)}
                </option>
              ))}
            </select>
          )}
          {scanning && (
            <p className="mt-2 text-xs text-slate-400">
              Pare a leitura para trocar de refeição.
            </p>
          )}
        </section>

        {/* Câmera / resultado */}
        <section className="card overflow-hidden">
          <div className="relative">
            {/* O elemento do leitor precisa existir (e não estar display:none)
                antes de iniciar a câmera, senão a lib não consegue medi-lo. */}
            <div id="qr-reader" className="mx-auto w-full" />

            {/* Overlay colorido do resultado */}
            {ui && (
              <div
                className={`absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center text-white ${ui.bg}`}
              >
                <div className="text-6xl font-black leading-none">{ui.icon}</div>
                {result?.cadet && (
                  <>
                    <p className="mt-3 text-2xl font-extrabold leading-tight">
                      {result.cadet.name}
                    </p>
                    <p className="text-base font-medium opacity-90">
                      {result.cadet.number} · {result.cadet.squadron_label}
                    </p>
                  </>
                )}
                <p className="mt-3 text-xl font-extrabold uppercase tracking-wide">
                  {ui.label}
                </p>
                {result?.status === "ja_registrado" && result.entered_at && (
                  <p className="mt-1 text-base font-semibold">
                    às {hhmm(result.entered_at)}
                  </p>
                )}
                {result?.status === "autorizado" && result.entered_at && (
                  <p className="mt-1 text-base font-semibold">
                    {hhmm(result.entered_at)}
                  </p>
                )}
                {result?.reason && result.status !== "autorizado" && (
                  <p className="mt-1 text-sm opacity-90">{result.reason}</p>
                )}
              </div>
            )}

            {!scanning && !ui && (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-slate-400 dark:text-gray-500">
                <span className="text-5xl">📷</span>
                <p className="mt-3 text-sm">
                  Selecione a refeição e inicie a leitura para abrir a câmera.
                </p>
              </div>
            )}
          </div>

          {camError && (
            <p className="px-5 pb-3 text-center text-sm text-red-600 dark:text-red-400">
              {camError}
            </p>
          )}

          <div className="border-t border-slate-100 p-4 dark:border-gray-700">
            {scanning ? (
              <button className="btn-secondary w-full" onClick={stopScanning}>
                ⏹ Parar leitura
              </button>
            ) : (
              <button
                className="btn-primary w-full"
                onClick={startScanner}
                disabled={!slotId}
              >
                ▶ Iniciar leitura
              </button>
            )}
          </div>
        </section>

        {/* Anotação de fraude: QR já usado, possivelmente por outra pessoa */}
        {flagTarget && (
          <section className="card overflow-hidden border-l-4 border-amber-500 animate-fade-in">
            <div className="bg-amber-50 px-5 py-3 dark:bg-amber-500/10">
              <h3 className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
                ⚠ QR já usado
              </h3>
              <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-200/70">
                Este QR é de{" "}
                <span className="font-semibold">{flagTarget.ownerName}</span> (
                {flagTarget.ownerNumber}) e já entrou. Se quem está aqui é{" "}
                <span className="font-semibold">outra pessoa</span>, registre
                abaixo para apuração. Se for o próprio dono por engano, ignore.
              </p>
            </div>

            {flagDone ? (
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <p className="text-sm font-semibold text-emerald-600">
                  ✓ Irregularidade registrada.
                </p>
                <button
                  className="btn-ghost px-3 py-1.5 text-sm"
                  onClick={() => setFlagTarget(null)}
                >
                  Fechar
                </button>
              </div>
            ) : (
              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-gray-300">
                    Quem está usando este QR? (nome ou número)
                  </label>
                  <input
                    className="input"
                    placeholder="Ex: 26/1234 João Silva"
                    value={flagPerson}
                    onChange={(e) => setFlagPerson(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-gray-300">
                    Observação (opcional)
                  </label>
                  <input
                    className="input"
                    placeholder="Detalhes da ocorrência"
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                  />
                </div>
                {flagError && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {flagError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    className="btn-danger flex-1"
                    onClick={submitFlag}
                    disabled={flagBusy}
                  >
                    {flagBusy ? "Registrando…" : "Registrar irregularidade"}
                  </button>
                  <button
                    className="btn-ghost px-3"
                    onClick={() => setFlagTarget(null)}
                    disabled={flagBusy}
                  >
                    Ignorar
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Contador */}
        {selectedSlot && (
          <div className="card flex items-center justify-center gap-2 px-5 py-3 text-center">
            <span className="text-2xl font-black text-emerald-600">{count}</span>
            <span className="text-sm text-slate-500 dark:text-gray-400">
              entradas registradas nesta refeição
            </span>
          </div>
        )}

        {/* Últimas leituras */}
        {recent.length > 0 && (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-navy-800 dark:text-gray-100">
                Últimas leituras
              </h3>
            </div>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-gray-700">
              {recent.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center gap-3 px-5 py-2.5 text-sm"
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      STATUS_UI[r.status].bg
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-gray-200">
                    {r.name}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {r.number}
                  </span>
                  <span className="text-xs text-slate-400">{r.time}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
