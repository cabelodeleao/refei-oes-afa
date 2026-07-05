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

// Agrupa slots por data. asc=false coloca o dia mais recente primeiro (histórico).
function groupDays(slots: Slot[], asc: boolean) {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date)!.push(s);
  }
  return Array.from(map.entries())
    .sort((a, b) => (asc ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
    .map(([date, daySlots]) => ({ date, daySlots }));
}

export default function CadeteClient({ user, qrToken }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Aba "Últimos 7 dias": consulta somente-leitura das refeições passadas
  // (carregada sob demanda na 1ª abertura e mantida em memória).
  const [tab, setTab] = useState<"atuais" | "antigas">("atuais");
  const [histSlots, setHistSlots] = useState<Slot[] | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState("");

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

  // Persiste UMA marcação em segundo plano. A UI já foi atualizada de forma
  // otimista por quem chamou (zero delay). Em caso de sucesso, nada acontece —
  // o próprio estado visual da refeição é o feedback. Só falhas geram aviso:
  // aí revertemos aquele toggle específico e mostramos um toast de erro.
  const saveMark = useCallback(
    async (slotId: string, marked: boolean) => {
      try {
        const res = await apiFetch("/api/marks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot_id: slotId, marked }),
        });
        if (!res.ok) {
          setSlots((prev) =>
            prev.map((s) => (s.id === slotId ? { ...s, marked: !marked } : s))
          );
          toast.error("Não foi possível salvar uma refeição. Tente novamente.");
        }
      } catch {
        setSlots((prev) =>
          prev.map((s) => (s.id === slotId ? { ...s, marked: !marked } : s))
        );
        toast.error("Erro de conexão ao salvar.");
      }
    },
    [toast]
  );

  // Abre a aba de antigas; busca do servidor só na primeira vez.
  async function openHistory() {
    setTab("antigas");
    if (histSlots !== null || histLoading) return;
    setHistLoading(true);
    setHistError("");
    try {
      const res = await apiFetch("/api/slots?history=1");
      const data = await res.json();
      if (res.ok) setHistSlots(data.slots ?? []);
      else setHistError(data.error ?? "Erro ao carregar refeições antigas");
    } catch {
      setHistError("Erro de conexão");
    } finally {
      setHistLoading(false);
    }
  }

  // Agrupa por data: próximas em ordem cronológica; antigas com o dia mais
  // recente primeiro (mais natural para consulta).
  const days = useMemo(() => groupDays(slots, true), [slots]);
  const histDays = useMemo(() => groupDays(histSlots ?? [], false), [histSlots]);

  // 3º/4º esquadrão podem desmarcar refeições "todos" (opt-out).
  const optOut = isOptOutSquadron(user.squadron);

  // Pode alternar: opcional sempre; "todos" só p/ 3º/4º; nunca se bloqueado.
  function canToggle(slot: Slot): boolean {
    if (slot.locked) return false;
    if (slot.access === "opcional") return true;
    return optOut; // access === "todos"
  }

  // Marca/desmarca uma refeição: UI otimista + SAVE imediato.
  function applyMark(slot: Slot, next: boolean) {
    if (!canToggle(slot) || slot.marked === next) return;
    setSlots((prev) =>
      prev.map((s) => (s.id === slot.id ? { ...s, marked: next } : s))
    );
    void saveMark(slot.id, next);
  }

  // "Marcar todas": aplica a todas as refeições do dia que o cadete PODE alterar
  // (opcionais sempre; obrigatórias só p/ 3º/4º; nunca as bloqueadas). Cada uma
  // é salva imediatamente; o toast único sai 2s após o último save.
  function toggleAllDay(daySlots: Slot[], checked: boolean) {
    const changed = daySlots.filter((s) => canToggle(s) && s.marked !== checked);
    if (changed.length === 0) return;
    const ids = new Set(changed.map((s) => s.id));
    setSlots((prev) =>
      prev.map((s) => (ids.has(s.id) ? { ...s, marked: checked } : s))
    );
    for (const s of changed) void saveMark(s.id, checked);
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const initial = (user.name.trim()[0] ?? "?").toUpperCase();

  // Card de um dia. readOnly = aba de antigas (sem "Todas", nada clicável —
  // os slots já chegam com locked=true do servidor e mostram 🔒 Sim/Não).
  function dayCard(date: string, daySlots: Slot[], readOnly: boolean) {
    const markedCount = daySlots.filter((s) => s.marked).length;
    const [wd, dt] = formatLongDate(date).split(", ");
    const editable = daySlots.filter(canToggle);
    const allMarked = editable.length > 0 && editable.every((s) => s.marked);
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
              {markedCount} {markedCount === 1 ? "marcada" : "marcadas"}
            </div>
            {!readOnly && (
              <DayAllToggle
                checked={allMarked}
                indeterminate={someMarked && !allMarked}
                disabled={editable.length === 0}
                onChange={(c) => toggleAllDay(daySlots, c)}
              />
            )}
          </div>
        </div>

        {MEAL_TYPES.filter((mt) => daySlots.some((s) => s.meal_type === mt)).map(
          (mt) => {
            const slot = daySlots.find((s) => s.meal_type === mt)!;
            // "todos" estrito (1º/2º) = obrigatória, não clicável.
            const strict = slot.access === "todos" && !optOut;
            const clickable =
              !slot.locked && (slot.access === "opcional" || optOut);

            // Bloqueada: além do cadeado, a cor identifica a escolha
            // (verde = marcada "Sim", vermelho = "Não").
            const stateClass = slot.locked
              ? `blocked ${slot.marked ? "blocked-yes" : "blocked-no"}`
              : strict
              ? "lock"
              : slot.marked
              ? "on"
              : "off";

            const right = slot.locked ? (
              <span
                className={slot.marked ? "cad-pill-lock-yes" : "cad-pill-lock-no"}
              >
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
          }
        )}
      </div>
    );
  }

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

        {/* Seção + abas */}
        <div className="cad-max cad-sect">
          <h2>Suas Refeições</h2>
          <div className="cad-hint">
            {tab === "atuais" ? "Toque para marcar" : "Somente consulta"}
          </div>
        </div>
        <div className="cad-max cad-tabs">
          <button
            type="button"
            className={`cad-tab${tab === "atuais" ? " active" : ""}`}
            onClick={() => setTab("atuais")}
          >
            Próximas
          </button>
          <button
            type="button"
            className={`cad-tab${tab === "antigas" ? " active" : ""}`}
            onClick={openHistory}
          >
            Últimos 7 dias
          </button>
        </div>

        {tab === "atuais" && (
          <>
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
                {days.map(({ date, daySlots }) => dayCard(date, daySlots, false))}
              </div>
            )}
          </>
        )}

        {tab === "antigas" && (
          <>
            {histLoading && (
              <div
                className="cad-max"
                style={{ marginTop: 16, color: "#8b97a8", fontSize: 14 }}
              >
                Carregando…
              </div>
            )}

            {histError && !histLoading && (
              <div
                className="cad-max"
                style={{ marginTop: 16, color: "#ff9a9a", fontSize: 14 }}
              >
                {histError}
              </div>
            )}

            {!histLoading && !histError && histDays.length === 0 && (
              <div
                className="cad-max"
                style={{ marginTop: 16, color: "#8b97a8", fontSize: 14 }}
              >
                Nenhuma refeição nos últimos 7 dias.
              </div>
            )}

            {!histLoading && histDays.length > 0 && (
              <div className="cad-max cad-grid">
                {histDays.map(({ date, daySlots }) => dayCard(date, daySlots, true))}
              </div>
            )}
          </>
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
