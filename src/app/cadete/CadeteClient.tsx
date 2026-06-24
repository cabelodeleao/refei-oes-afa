"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client";
import {
  MEAL_TYPES,
  MEAL_LABELS,
  MEAL_ICONS,
  SQUADRON_LABELS,
  isOptOutSquadron,
  type MealType,
  type AccessState,
} from "@/lib/constants";
import MenuBanner from "@/components/MenuBanner";
import MyQrCode from "@/components/MyQrCode";
import { useToast } from "@/components/Toast";
import { formatLongDate } from "@/lib/dates";

interface Slot {
  id: string;
  date: string;
  meal_type: MealType;
  access: Exclude<AccessState, "ninguem">; // "opcional" | "todos"
  locked: boolean;
  marked: boolean;
}

interface Props {
  user: { name: string; number: string; squadron: number };
  qrToken: string | null;
}

export default function CadeteClient({ user, qrToken }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Indicador discreto de salvamento em lote (debounce).
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "pending" | "saving" | "saved"
  >("idle");

  // Alterações pendentes (slot_id -> valor desejado) acumuladas entre cliques.
  // Gravamos tudo de uma vez 2s após o último clique (debounce), evitando uma
  // chuva de avisos quando o cadete marca várias refeições em sequência.
  const dirtyRef = useRef<Map<string, boolean>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/slots");
        const data = await res.json();
        if (res.ok) setSlots(data.slots ?? []);
        else setError(data.error ?? "Erro ao carregar refeições");
      } catch {
        setError("Erro de conexão");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Grava todas as alterações pendentes de uma vez. Um único toast no fim.
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const changes = Array.from(dirtyRef.current.entries());
    if (changes.length === 0) return;
    dirtyRef.current.clear();
    setSaveStatus("saving");
    try {
      const results = await Promise.all(
        changes.map(([slot_id, marked]) =>
          apiFetch("/api/marks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot_id, marked }),
          })
        )
      );
      if (results.every((r) => r.ok)) {
        clearTimeout(savedTimer.current);
        setSaveStatus("saved");
        toast.success("Refeições salvas com sucesso! ✓");
        savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2500);
      } else {
        // Alguma falhou: ressincroniza com o servidor e avisa.
        setSaveStatus("idle");
        toast.error("Não foi possível salvar tudo. Recarregando…");
        try {
          const res = await apiFetch("/api/slots");
          const data = await res.json();
          if (res.ok) setSlots(data.slots ?? []);
        } catch {
          /* mantém o estado atual */
        }
      }
    } catch {
      setSaveStatus("idle");
      toast.error("Erro de conexão ao salvar.");
    }
  }, [toast]);

  // Agenda (ou reagenda) o salvamento em lote 2s após o último clique.
  const scheduleSave = useCallback(() => {
    setSaveStatus("pending");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flush();
    }, 2000);
  }, [flush]);

  // Garante que nada se perca ao sair: grava na desmontagem e no beforeunload.
  // No unload usamos keepalive para a requisição sobreviver à navegação.
  useEffect(() => {
    function flushOnUnload() {
      const changes = Array.from(dirtyRef.current.entries());
      if (changes.length === 0) return;
      dirtyRef.current.clear();
      for (const [slot_id, marked] of changes) {
        try {
          fetch("/api/marks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot_id, marked }),
            keepalive: true,
          });
        } catch {
          /* best-effort */
        }
      }
    }
    window.addEventListener("beforeunload", flushOnUnload);
    return () => {
      window.removeEventListener("beforeunload", flushOnUnload);
      clearTimeout(saveTimer.current);
      clearTimeout(savedTimer.current);
      flushOnUnload();
    };
  }, []);

  // Agrupa por data, mantendo ordem cronológica.
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      if (!map.has(s.date)) map.set(s.date, []);
      map.get(s.date)!.push(s);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, daySlots]) => ({ date, daySlots }));
  }, [slots]);

  // 3º/4º esquadrão podem desmarcar refeições "todos" (opt-out).
  const optOut = isOptOutSquadron(user.squadron);

  // Pode alternar: opcional sempre; "todos" só p/ 3º/4º; nunca se bloqueado.
  function canToggle(slot: Slot): boolean {
    if (slot.locked) return false;
    if (slot.access === "opcional") return true;
    return optOut; // access === "todos"
  }

  // Marca/desmarca uma refeição: atualização otimista + agenda gravação.
  function applyMark(slot: Slot, next: boolean) {
    if (!canToggle(slot) || slot.marked === next) return;
    setSlots((prev) =>
      prev.map((s) => (s.id === slot.id ? { ...s, marked: next } : s))
    );
    dirtyRef.current.set(slot.id, next);
    scheduleSave();
  }

  // "Marcar todas": aplica a todas as refeições do dia que o cadete PODE alterar
  // (opcionais sempre; obrigatórias só p/ 3º/4º; nunca as bloqueadas).
  function toggleAllDay(daySlots: Slot[], checked: boolean) {
    const editable = daySlots.filter(canToggle);
    if (editable.length === 0) return;
    const ids = new Set(editable.map((s) => s.id));
    setSlots((prev) =>
      prev.map((s) => (ids.has(s.id) ? { ...s, marked: checked } : s))
    );
    for (const s of editable) {
      if (s.marked !== checked) dirtyRef.current.set(s.id, checked);
    }
    if (dirtyRef.current.size > 0) scheduleSave();
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const initial = (user.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="cad-root">
      <div className="cad-wrap">
        {/* Topbar */}
        <div className="cad-max cad-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <div className="cad-avatar">{initial}</div>
            <div style={{ minWidth: 0 }}>
              <div className="cad-name">{user.name}</div>
              <div className="cad-meta">
                {user.number} · {SQUADRON_LABELS[user.squadron] ?? "—"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="cad-btn" onClick={() => setPwOpen(true)}>
              Trocar senha
            </button>
            <button
              className="cad-btn cad-btn-out"
              onClick={logout}
              disabled={loggingOut}
            >
              Sair
            </button>
          </div>
        </div>

        {/* Cardápio: imagem inteira visível no topo (clicável p/ ampliar) */}
        <div className="cad-max">
          <MenuBanner />
        </div>

        {/* Seção */}
        <div className="cad-max cad-sect">
          <h2>Suas Refeições</h2>
          {saveStatus === "saving" ? (
            <div className="cad-save cad-save-busy">Salvando…</div>
          ) : saveStatus === "pending" ? (
            <div className="cad-save cad-save-busy">Salvando…</div>
          ) : saveStatus === "saved" ? (
            <div className="cad-save cad-save-ok">Salvo ✓</div>
          ) : (
            <div className="cad-hint">Toque para marcar</div>
          )}
        </div>

        {loading && (
          <div
            className="cad-max"
            style={{ marginTop: 16, color: "#8b97a8", fontSize: 14 }}
          >
            Carregando…
          </div>
        )}

        {error && !loading && (
          <div
            className="cad-max"
            style={{ marginTop: 16, color: "#ff9a9a", fontSize: 14 }}
          >
            {error}
          </div>
        )}

        {!loading && !error && days.length === 0 && (
          <div
            className="cad-max"
            style={{ marginTop: 16, color: "#8b97a8", fontSize: 14 }}
          >
            Nenhuma refeição disponível no momento.
          </div>
        )}

        {!loading && days.length > 0 && (
          <div className="cad-max cad-grid">
            {days.map(({ date, daySlots }) => {
              const markedCount = daySlots.filter((s) => s.marked).length;
              const [wd, dt] = formatLongDate(date).split(", ");
              const editable = daySlots.filter(canToggle);
              const allMarked =
                editable.length > 0 && editable.every((s) => s.marked);
              const someMarked = editable.some((s) => s.marked);
              return (
                <div className="cad-day" key={date}>
                  <div className="cad-day-head">
                    <div>
                      <div className="cad-day-wd">{wd}</div>
                      <div className="cad-day-dt">{dt}</div>
                    </div>
                    <div className="cad-day-head-right">
                      <div className="cad-count">
                        {markedCount}{" "}
                        {markedCount === 1 ? "marcada" : "marcadas"}
                      </div>
                      <DayAllToggle
                        checked={allMarked}
                        indeterminate={someMarked && !allMarked}
                        disabled={editable.length === 0}
                        onChange={(c) => toggleAllDay(daySlots, c)}
                      />
                    </div>
                  </div>

                  {MEAL_TYPES.filter((mt) =>
                    daySlots.some((s) => s.meal_type === mt)
                  ).map((mt) => {
                    const slot = daySlots.find((s) => s.meal_type === mt)!;
                    // "todos" estrito (1º/2º) = obrigatória, não clicável.
                    const strict = slot.access === "todos" && !optOut;
                    const clickable =
                      !slot.locked && (slot.access === "opcional" || optOut);

                    const stateClass = slot.locked
                      ? "blocked"
                      : strict
                      ? "lock"
                      : slot.marked
                      ? "on"
                      : "off";

                    const right = slot.locked ? (
                      <span className="cad-pill-muted">
                        🔒 {slot.marked ? "Sim" : "Não"}
                      </span>
                    ) : strict ? (
                      <span className="cad-pill-req">Obrigatória</span>
                    ) : slot.marked ? (
                      <span className="cad-pill-box">✓</span>
                    ) : (
                      <span className="cad-pill-box" />
                    );

                    const inner = (
                      <>
                        <span className="cad-meal-left">
                          <span className="cad-meal-ic" aria-hidden>
                            {MEAL_ICONS[mt]}
                          </span>
                          <span className="cad-meal-nm">{MEAL_LABELS[mt]}</span>
                        </span>
                        {right}
                      </>
                    );

                    return clickable ? (
                      <button
                        key={slot.id}
                        type="button"
                        className={`cad-meal ${stateClass}`}
                        onClick={() => applyMark(slot, !slot.marked)}
                      >
                        {inner}
                      </button>
                    ) : (
                      <div key={slot.id} className={`cad-meal ${stateClass}`}>
                        {inner}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        <div className="cad-foot">REFEIÇÕES AFA</div>
      </div>

      {/* QR: botão flutuante + modal */}
      <MyQrCode token={qrToken} name={user.name} number={user.number} />

      {/* Trocar senha (sheet escuro) */}
      {pwOpen && <ChangePasswordSheet onClose={() => setPwOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

// Caixa "Marcar todas" do dia. Suporta estado indeterminado (algumas marcadas).
function DayAllToggle({
  checked,
  indeterminate,
  disabled,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !disabled && indeterminate;
  }, [indeterminate, disabled]);

  return (
    <label className={`cad-allday${disabled ? " disabled" : ""}`}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Todas
    </label>
  );
}

// ---------------------------------------------------------------------------

function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 6) {
      toast.error("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (next !== confirm) {
      toast.error("A confirmação não corresponde à nova senha.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao trocar a senha.");
      } else {
        toast.success("Senha alterada com sucesso!");
        onClose();
      }
    } catch {
      toast.error("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cad-overlay" onClick={onClose}>
      <form
        className="cad-sheet"
        style={{ width: 360, maxWidth: "calc(100vw - 48px)", padding: 26 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: 18 }}
        >
          <span
            style={{
              fontFamily: "var(--font-sora), Sora, sans-serif",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Trocar senha
          </span>
          <button
            type="button"
            className="cad-x"
            onClick={onClose}
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            className="cad-field"
            type="password"
            placeholder="Senha atual"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <input
            className="cad-field"
            type="password"
            placeholder="Nova senha (mín. 6 caracteres)"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <input
            className="cad-field"
            type="password"
            placeholder="Confirmar nova senha"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <button className="cad-submit" type="submit" disabled={loading}>
            {loading ? "Salvando…" : "Salvar nova senha"}
          </button>
        </div>
      </form>
    </div>
  );
}
