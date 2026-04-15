import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess, type Square, type Color } from "chess.js";
import type { Room } from "colyseus.js";
import {
  consumePredictReservation,
  formatJoinError,
  joinPredictRoom,
  releasePredictRoom,
} from "../lib/colyseus";
import type { PredictChessState } from "../schema/PredictChessState";
import { isMoveLegalForSide } from "../game/validation";

type Planned = { from: Square; to: Square };

const EMPTY_PLAN: Planned[] = Array.from({ length: 5 }, () => ({
  from: "" as Square,
  to: "" as Square,
}));

function planFromState(
  moves: { from: string; to: string }[] | undefined
): Planned[] {
  const out = EMPTY_PLAN.map((_, i) => {
    const m = moves?.[i];
    if (!m?.from || !m?.to) return { from: "" as Square, to: "" as Square };
    return { from: m.from as Square, to: m.to as Square };
  });
  return out;
}

export function GamePage() {
  const { roomId = "" } = useParams();
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room<PredictChessState> | null>(null);
  const [phase, setPhase] = useState<string>("lobby");
  const [serverFen, setServerFen] = useState(() => new Chess().fen());
  const [timerMs, setTimerMs] = useState(0);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [winner, setWinner] = useState("");
  const [roundIndex, setRoundIndex] = useState(0);
  const [playersCount, setPlayersCount] = useState(0);
  const [plan, setPlan] = useState<Planned[]>(() =>
    EMPTY_PLAN.map((p) => ({ ...p }))
  );
  const [locked, setLocked] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [displayFen, setDisplayFen] = useState(() => new Chess().fen());
  const animTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [pickFrom, setPickFrom] = useState<Square | null>(null);

  const orientation = myColor === "b" ? "black" : "white";

  const applyState = useCallback((s: PredictChessState, sessionId: string) => {
    setPhase(s.phase ?? "lobby");
    if (s.fen) setServerFen(s.fen);
    setTimerMs(s.timerMs ?? 0);
    setWinner(s.winner ?? "");
    setRoundIndex(s.roundIndex ?? 0);

    // First Colyseus sync can omit nested Schema fields briefly ("refId" hydration).
    const players = s.players;
    setPlayersCount(players?.size ?? 0);
    if (!players) return;

    const me = [...players.values()].find((p) => p.sessionId === sessionId);
    if (me?.color === "white") setMyColor("w");
    else if (me?.color === "black") setMyColor("b");

    if (s.phase === "planning") {
      const wm = s.whiteMoves?.toArray?.() ?? [];
      const bm = s.blackMoves?.toArray?.() ?? [];
      const raw = me?.color === "black" ? bm : wm;
      setPlan(planFromState(raw));
      if (me?.color === "white") setLocked(s.whiteLocked);
      else if (me?.color === "black") setLocked(s.blackLocked);
    }

    if (s.phase === "planning" || s.phase === "lobby") {
      if (s.fen) setDisplayFen(s.fen);
    }
  }, []);

  const applyStatus = useCallback(
    (
      msg: {
        phase?: string;
        fen?: string;
        timerMs?: number;
        roundIndex?: number;
        winner?: string;
        whiteLocked?: boolean;
        blackLocked?: boolean;
        players?: Array<{ sessionId: string; color: string; connected: boolean }>;
      },
      sessionId: string
    ) => {
      if (!msg) return;
      setPhase(msg.phase ?? "lobby");
      if (msg.fen) {
        setServerFen(msg.fen);
        if (msg.phase === "planning" || msg.phase === "lobby") setDisplayFen(msg.fen);
      }
      setTimerMs(msg.timerMs ?? 0);
      setWinner(msg.winner ?? "");
      setRoundIndex(msg.roundIndex ?? 0);
      const players: Array<{ sessionId: string; color: string; connected: boolean }> =
        msg.players ?? [];
      setPlayersCount(players.length);
      const me = players.find((p) => p.sessionId === sessionId);
      if (me?.color === "white") setMyColor("w");
      else if (me?.color === "black") setMyColor("b");
      if (me?.color === "white") setLocked(!!msg.whiteLocked);
      if (me?.color === "black") setLocked(!!msg.blackLocked);
    },
    []
  );

  useEffect(() => {
    let joined: Room<PredictChessState> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const resKey = `predichess:reservation:${roomId}`;
        const reservationRaw = sessionStorage.getItem(resKey);
        if (reservationRaw) sessionStorage.removeItem(resKey);

        const r = reservationRaw
          ? await consumePredictReservation(JSON.parse(reservationRaw))
          : await joinPredictRoom(roomId);
        if (cancelled) {
          void releasePredictRoom(roomId, r);
          return;
        }
        joined = r;
        setRoom(r);
        applyState(r.state, r.sessionId);
        r.onStateChange((state) => {
          applyState(state, r.sessionId);
        });
        r.onMessage("status", (m) => applyStatus(m, r.sessionId));
        r.send("status_req");
      } catch (err) {
        console.error("joinPredictRoom", err);
        if (!cancelled) setError(formatJoinError(err));
      }
    })();

    return () => {
      cancelled = true;
      if (joined) void releasePredictRoom(roomId, joined);
      if (animTimer.current) clearInterval(animTimer.current);
    };
  }, [roomId, applyState, applyStatus]);

  useEffect(() => {
    if (!room?.state || phase !== "resolution") return;
    const steps = room.state.lastResolutionSteps?.toArray?.() ?? [];
    if (animTimer.current) clearInterval(animTimer.current);

    const startId = window.setTimeout(() => {
      if (steps.length === 0) {
        setDisplayFen(room.state.fen);
        return;
      }
      let i = 0;
      setDisplayFen(steps[0]?.fenAfter ?? room.state.fen);
      animTimer.current = setInterval(() => {
        i += 1;
        if (i >= steps.length) {
          if (animTimer.current) clearInterval(animTimer.current);
          return;
        }
        setDisplayFen(steps[i].fenAfter);
      }, 650);
    }, 0);

    return () => {
      window.clearTimeout(startId);
      if (animTimer.current) clearInterval(animTimer.current);
    };
  }, [phase, room, roundIndex]);

  function computePlanningFen(baseFen: string, nextPlan: Planned[], color: Color): string {
    let fen = baseFen;
    for (const m of nextPlan) {
      if (!m.from || !m.to) continue;
      const step = new Chess();
      step.load(fen);
      step.setTurn(color);
      const verbose = step.moves({ square: m.from, verbose: true });
      const found = verbose.find((mv) => mv.to === m.to);
      if (!found) break;
      const res = step.move({ from: m.from, to: m.to, promotion: found.promotion });
      if (!res) break;
      fen = step.fen();
    }
    return fen;
  }

  const planningFen = useMemo(() => {
    if (phase !== "planning" || !myColor) return serverFen;
    return computePlanningFen(serverFen, plan, myColor);
  }, [phase, myColor, serverFen, plan]);

  const boardFen = phase === "planning" ? planningFen : displayFen;

  const canEditPlan =
    phase === "planning" && myColor && !locked && timerMs > 0;

  const historyFens = useMemo(() => {
    const rounds = room?.state?.resolvedRounds?.toArray?.() ?? [];
    const out: string[] = [];
    for (const r of rounds) {
      const steps = r.steps?.toArray?.() ?? [];
      for (const s of steps) {
        if (s?.fenAfter) out.push(s.fenAfter);
      }
    }
    return out;
  }, [room]);

  const viewingHistory =
    historyCursor != null && historyCursor >= 0 && historyCursor < historyFens.length;
  const effectiveBoardFen = viewingHistory ? historyFens[historyCursor!] : boardFen;

  const movedPieceSquares = useMemo(() => {
    const s = new Set<Square>();
    for (const m of plan) {
      if (m.from && m.to) s.add(m.to);
    }
    return s;
  }, [plan]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1400);
    return () => window.clearTimeout(id);
  }, [toast]);

  // planningFen is derived via useMemo above.

  function findNextEmptySlot(nextPlan: Planned[], fromIndex: number): number | null {
    for (let i = 0; i < nextPlan.length; i++) {
      const idx = (fromIndex + i) % nextPlan.length;
      const s = nextPlan[idx];
      if (!s.from || !s.to) return idx;
    }
    return null;
  }

  function onPieceDrop(sourceSquare: Square, targetSquare: Square): boolean {
    if (!canEditPlan || !myColor || viewingHistory) return false;
    if (movedPieceSquares.has(sourceSquare)) {
      setToast("Quel pezzo è già stato mosso in questo round.");
      return false;
    }
    const slot = plan[activeSlot];
    if (slot.from && slot.to) {
      return false;
    }
    const legal = isMoveLegalForSide(serverFen, sourceSquare, targetSquare, myColor);
    if (!legal) return false;

    setPlan((prev) => {
      const next = prev.map((p) => ({ ...p }));
      const s = next[activeSlot];
      if (!s.from) {
        s.from = sourceSquare;
        s.to = targetSquare;
      } else {
        s.to = targetSquare;
      }
      return next;
    });
    const nextPlan = plan.map((p, i) =>
      i === activeSlot ? { from: sourceSquare, to: targetSquare } : { ...p }
    );
    // If the active slot is now complete, advance to the next empty slot.
    // (Uses the same nextPlan computed above.)
    const nextEmpty = findNextEmptySlot(nextPlan, activeSlot + 1);
    if (nextEmpty != null) setActiveSlot(nextEmpty);
    return true;
  }

  function clearSlot(i: number) {
    setPlan((prev) => {
      const next = prev.map((p) => ({ ...p }));
      next[i] = { from: "" as Square, to: "" as Square };
      return next;
    });
  }

  function confirmPlan() {
    if (!room || !canEditPlan || viewingHistory) return;
    const moves = plan.map((p) =>
      p.from && p.to ? { from: p.from, to: p.to } : { from: "", to: "" }
    );
    room.send("submit_plan", { moves });
    setLocked(true);
  }

  const slotsUi = useMemo(() => plan, [plan]);

  const lobbyWait =
    phase === "lobby" &&
    room?.state?.players != null &&
    room.state.players.size < 2;

  const myLabel =
    myColor === "w" ? "Bianco" : myColor === "b" ? "Nero" : "—";

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-3 pb-8 pt-6">
      {toast && (
        <div className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs text-slate-100 shadow-lg ring-1 ring-white/10">
          {toast}
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link to="/" className="text-sm text-indigo-400">
          Menu
        </Link>
        <div className="flex flex-col items-end gap-1 text-right">
          {roomId && (
            <span className="font-mono text-xs text-slate-500">
              Stanza {roomId}
            </span>
          )}
          <span className="text-[11px] text-slate-500">
            Fase: <span className="font-mono text-slate-300">{phase}</span> ·{" "}
            <span className="font-mono text-slate-300">
              {playersCount}/2
            </span>{" "}
            · Tu: <span className="font-mono text-slate-300">{myLabel}</span>
          </span>
        </div>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {lobbyWait && (
        <p className="mb-4 text-center text-slate-400">
          In attesa del secondo giocatore…
        </p>
      )}

      {!error && phase === "lobby" && playersCount === 2 && (
        <p className="mb-4 text-center text-slate-400">
          Entrambi connessi. Inizio partita…
        </p>
      )}

      {phase === "planning" && (
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-slate-400">Pianificazione</span>
          <span className="font-mono text-amber-300">
            {(timerMs / 1000).toFixed(1)}s
          </span>
        </div>
      )}

      {phase === "resolution" && (
        <p className="mb-3 text-center text-sm text-slate-400">
          Risoluzione — round {roundIndex + 1}
        </p>
      )}

      {phase === "finished" && winner && (
        <p className="mb-4 text-center text-lg text-white">
          Fine partita:{" "}
          <span className="text-indigo-300">
            {winner === "draw"
              ? "Patta"
              : winner === "white"
                ? "Vince il Bianco"
                : "Vince il Nero"}
          </span>
        </p>
      )}

      {phase !== "lobby" && phase !== "finished" && (
        <button
          type="button"
          className="mb-3 rounded-xl bg-rose-700/80 py-2 text-sm font-medium text-white disabled:opacity-40"
          onClick={() => room?.send("resign")}
          disabled={!room}
        >
          Arrenditi
        </button>
      )}

      <div className="w-full max-w-[min(100vw-24px,420px)] self-center">
        <Chessboard
          options={{
            position: effectiveBoardFen,
            boardOrientation: orientation,
            allowDragging: !!canEditPlan && !viewingHistory,
            onSquareClick: ({ square }) => {
              const sq = square as Square;
              if (!canEditPlan || !myColor || viewingHistory) return;
              if (!pickFrom) {
                if (movedPieceSquares.has(sq)) {
                  setToast("Quel pezzo è già stato mosso in questo round.");
                  return;
                }
                setPickFrom(sq);
                return;
              }
              const ok = onPieceDrop(pickFrom, sq);
              if (ok) setPickFrom(null);
            },
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare) return false;
              return onPieceDrop(sourceSquare as Square, targetSquare as Square);
            },
          }}
        />
      </div>

      {phase === "planning" && myColor && (
        <ManualMove
          disabled={!canEditPlan || viewingHistory}
          onSubmit={(from, to) => onPieceDrop(from, to)}
        />
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-40"
          onClick={() => {
            if (historyFens.length === 0) return;
            setHistoryCursor((cur) => {
              const next = cur == null ? historyFens.length - 1 : Math.max(0, cur - 1);
              return next;
            });
          }}
          disabled={historyFens.length === 0}
        >
          Indietro
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-40"
          onClick={() => setHistoryOpen(true)}
          disabled={historyFens.length === 0}
        >
          Storico
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-40"
          onClick={() => {
            if (historyFens.length === 0) return;
            setHistoryCursor((cur) => {
              if (cur == null) return null;
              const next = cur + 1;
              return next >= historyFens.length ? null : next;
            });
          }}
          disabled={historyFens.length === 0 || historyCursor == null}
        >
          Avanti
        </button>
      </div>

      {viewingHistory && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Modalità storico: input mosse disabilitato ({historyCursor! + 1}/{historyFens.length})
        </p>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setHistoryOpen(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[70dvh] rounded-t-2xl border border-white/10 bg-slate-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">Storico</h2>
              <button
                type="button"
                className="rounded-lg bg-slate-800 px-3 py-1 text-xs"
                onClick={() => setHistoryOpen(false)}
              >
                Chiudi
              </button>
            </div>
            <div className="space-y-2 overflow-auto pr-1">
              {(room?.state?.resolvedRounds?.toArray?.() ?? []).map((r, ri) => {
                const steps = r.steps?.toArray?.() ?? [];
                const lastFen = steps.length ? steps[steps.length - 1].fenAfter : r.fenAfter;
                const anyCollision = steps.some((s) => !!s.collision);
                const captures = steps.flatMap((s) => s.captures?.toArray?.() ?? []);
                return (
                  <button
                    key={ri}
                    type="button"
                    className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-left text-xs"
                    onClick={() => {
                      const idx = historyFens.findLastIndex((f) => f === lastFen);
                      if (idx >= 0) setHistoryCursor(idx);
                      setHistoryOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-slate-200">Round {r.roundIndex + 1}</span>
                      <span className="text-slate-500">
                        {anyCollision ? "collisione" : "—"}
                        {captures.length ? ` · catture ${captures.length}` : ""}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">
                      {steps
                        .map((s) => `${s.whiteMove || "—"}/${s.blackMove || "—"}`)
                        .join(" · ")}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {phase === "planning" && myColor && (
        <>
          <p className="mt-4 text-center text-xs text-slate-500">
            Sei {myColor === "w" ? "Bianco" : "Nero"} — slot attivo:{" "}
            {activeSlot + 1}
          </p>

          <div className="mt-3 grid grid-cols-5 gap-2">
            {slotsUi.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveSlot(i)}
                className={`flex min-h-14 flex-col rounded-lg border px-1 py-2 text-center text-[10px] leading-tight ${
                  activeSlot === i
                    ? "border-indigo-500 bg-indigo-950/50"
                    : "border-white/10 bg-slate-900"
                }`}
              >
                <span className="text-slate-500">#{i + 1}</span>
                <span className="font-mono text-slate-200">
                  {p.from && p.to ? `${p.from}→${p.to}` : "—"}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => clearSlot(activeSlot)}
              className="flex-1 rounded-lg bg-slate-800 py-2 text-sm"
                disabled={!canEditPlan || viewingHistory}
            >
              Svuota slot
            </button>
            <button
              type="button"
              onClick={confirmPlan}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium disabled:opacity-40"
                disabled={!canEditPlan || locked || viewingHistory}
            >
              Conferma
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ManualMove({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (from: Square, to: Square) => boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
      <label className="text-[11px] text-slate-500">
        Da
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-2 font-mono text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2 disabled:opacity-40"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="e2"
          maxLength={2}
          disabled={disabled}
        />
      </label>
      <label className="text-[11px] text-slate-500">
        A
        <input
          className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-2 font-mono text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2 disabled:opacity-40"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="e4"
          maxLength={2}
          disabled={disabled}
        />
      </label>
      <button
        type="button"
        className="mb-[2px] rounded-lg bg-slate-800 px-3 py-2 text-xs disabled:opacity-40"
        disabled={disabled}
        onClick={() => {
          const f = from.trim().toLowerCase();
          const t = to.trim().toLowerCase();
          if (!/^[a-h][1-8]$/.test(f) || !/^[a-h][1-8]$/.test(t)) return;
          const ok = onSubmit(f as Square, t as Square);
          if (ok) {
            setFrom("");
            setTo("");
          }
        }}
      >
        Inserisci
      </button>
    </div>
  );
}
