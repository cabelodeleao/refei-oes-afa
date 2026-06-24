"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Toast de "salvo" com debounce: ao marcar várias refeições em sequência,
  // mostra um único toast ~700ms após a última gravação bem-sucedida.
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  function notifySaved() {
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(
      () => toast.success("Refeições salvas com sucesso! ✓"),
      700
    );
  }

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

  async function toggle(slot: Slot, next: boolean) {
    if (!canToggle(slot) || pending.has(slot.id)) return;
    // Atualização otimista
    setSlots((prev) =>
      prev.map((s) => (s.id === slot.id ? { ...s, marked: next } : s))
    );
    setPending((p) => new Set(p).add(slot.id));
    try {
      const res = await apiFetch("/api/marks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot_id: slot.id, marked: next }),
      });
      if (!res.ok) {
        setSlots((prev) =>
          prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
        );
        clearTimeout(savedTimer.current);
        toast.error("Não foi possível salvar. Tente novamente.");
      } else {
        notifySaved();
      }
    } catch {
      setSlots((prev) =>
        prev.map((s) => (s.id === slot.id ? { ...s, marked: !next } : s))
      );
      clearTimeout(savedTimer.current);
      toast.error("Erro de conexão.");
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(slot.id);
        return n;
      });
    }
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
          <div className="cad-hint">Toque para marcar</div>
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
              return (
                <div className="cad-day" key={date}>
                  <div className="cad-day-head">
                    <div>
                      <div className="cad-day-wd">{wd}</div>
                      <div className="cad-day-dt">{dt}</div>
                    </div>
                    <div className="cad-count">
                      {markedCount} {markedCount === 1 ? "marcada" : "marcadas"}
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
                        disabled={pending.has(slot.id)}
                        onClick={() => toggle(slot, !slot.marked)}
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
