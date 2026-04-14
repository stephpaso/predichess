import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess, type Square, type Color } from "chess.js";
import type { Room } from "colyseus.js";
import { formatJoinError, joinPredictRoom } from "../lib/colyseus";
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
  const [fen, setFen] = useState(() => new Chess().fen());
  const [timerMs, setTimerMs] = useState(0);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [winner, setWinner] = useState("");
  const [roundIndex, setRoundIndex] = useState(0);
  const [plan, setPlan] = useState<Planned[]>(() =>
    EMPTY_PLAN.map((p) => ({ ...p }))
  );
  const [locked, setLocked] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [displayFen, setDisplayFen] = useState(() => new Chess().fen());
  const animTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const orientation = myColor === "b" ? "black" : "white";

  const applyState = useCallback((s: PredictChessState, sessionId: string) => {
    setPhase(s.phase ?? "lobby");
    if (s.fen) setFen(s.fen);
    setTimerMs(s.timerMs ?? 0);
    setWinner(s.winner ?? "");
    setRoundIndex(s.roundIndex ?? 0);

    // First Colyseus sync can omit nested Schema fields briefly ("refId" hydration).
    const players = s.players;
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

  useEffect(() => {
    let joined: Room<PredictChessState> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const r = await joinPredictRoom(roomId);
        if (cancelled) {
          void r.leave();
          return;
        }
        joined = r;
        setRoom(r);
        applyState(r.state, r.sessionId);
        r.onStateChange(() => {
          applyState(r.state, r.sessionId);
        });
      } catch (err) {
        console.error("joinPredictRoom", err);
        if (!cancelled) setError(formatJoinError(err));
      }
    })();

    return () => {
      cancelled = true;
      if (joined) void joined.leave();
      if (animTimer.current) clearInterval(animTimer.current);
    };
  }, [roomId, applyState]);

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

  const planningFen = phase === "planning" ? fen : displayFen;

  const canEditPlan =
    phase === "planning" && myColor && !locked && timerMs > 0;

  function onPieceDrop(sourceSquare: Square, targetSquare: Square): boolean {
    if (!canEditPlan || !myColor) return false;
    const slot = plan[activeSlot];
    if (slot.from && slot.to) {
      return false;
    }
    const legal = isMoveLegalForSide(fen, sourceSquare, targetSquare, myColor);
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
    if (!room || !canEditPlan) return;
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

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col px-3 pb-8 pt-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link to="/" className="text-sm text-indigo-400">
          Menu
        </Link>
        {roomId && (
          <span className="font-mono text-xs text-slate-500">
            Stanza {roomId}
          </span>
        )}
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {lobbyWait && (
        <p className="mb-4 text-center text-slate-400">
          In attesa del secondo giocatore…
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

      <div className="w-full max-w-[min(100vw-24px,420px)] self-center">
        <Chessboard
          options={{
            position: planningFen,
            boardOrientation: orientation,
            allowDragging: !!canEditPlan,
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare) return false;
              return onPieceDrop(sourceSquare as Square, targetSquare as Square);
            },
          }}
        />
      </div>

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
              disabled={!canEditPlan}
            >
              Svuota slot
            </button>
            <button
              type="button"
              onClick={confirmPlan}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-medium disabled:opacity-40"
              disabled={!canEditPlan || locked}
            >
              Conferma
            </button>
          </div>
        </>
      )}
    </div>
  );
}
