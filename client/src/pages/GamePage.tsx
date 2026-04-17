import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess, type Square, type Color } from "chess.js";
import type { Room } from "colyseus.js";
import {
  consumePredictReservationForCode,
  formatJoinError,
  joinPredictRoom,
  joinPredictRoomByResolvedId,
  releasePredictRoom,
} from "../lib/colyseus";
import type { PredictChessState, RoundSnapshot, StepSnapshot } from "../schema/PredictChessState";
import {
  forkForSide,
  findVerboseMoveTo,
  getLegalTargetsForPlanning,
  isInCheckForSide,
  isMoveLegalForSide,
  withFenTurn,
} from "../game/validation";

type Planned = { from: Square; to: Square };

function makeEmptyPlan(slots: number): Planned[] {
  const n = Math.max(1, Math.min(5, Math.floor(slots || 0)));
  return Array.from({ length: n }, () => ({ from: "" as Square, to: "" as Square }));
}

function planFromState(
  moves: { from: string; to: string }[] | undefined,
  slots: number
): Planned[] {
  const base = makeEmptyPlan(slots);
  const out = base.map((_, i) => {
    const m = moves?.[i];
    if (!m?.from || !m?.to) return { from: "" as Square, to: "" as Square };
    return { from: m.from as Square, to: m.to as Square };
  });
  return out;
}

const RESOLUTION_STEP_MS = 600;
const BOARD_ANIM_MS = 280;

/**
 * Colyseus ArraySchema: prefer index iteration — `toArray()` can lag behind in-place
 * mutations, so nested history (resolvedRounds / steps) looked empty in the UI.
 */
function readArraySchema<T>(arr: unknown): T[] {
  if (arr == null) return [];
  const a = arr as {
    toArray?: () => T[];
    length?: number;
    at?: (i: number) => T;
    get?: (i: number) => T;
  };
  const len = typeof a.length === "number" ? a.length : 0;
  if (len > 0) {
    const out: T[] = [];
    for (let i = 0; i < len; i++) {
      const el = a.at?.(i) ?? a.get?.(i);
      if (el !== undefined) out.push(el as T);
    }
    if (out.length > 0) return out;
  }
  if (typeof a.toArray === "function") {
    try {
      const t = a.toArray();
      if (Array.isArray(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function GamePage() {
  const { roomId = "" } = useParams();
  const [search] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room<PredictChessState> | null>(null);
  const [phase, setPhase] = useState<string>("lobby");
  const [serverFen, setServerFen] = useState(() => new Chess().fen());
  const [timerMs, setTimerMs] = useState(0);
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [winner, setWinner] = useState("");
  const [roundIndex, setRoundIndex] = useState(0);
  const [playersCount, setPlayersCount] = useState(0);
  const [slotCount, setSlotCount] = useState(3);
  const [plan, setPlan] = useState<Planned[]>(() => makeEmptyPlan(3));
  const [locked, setLocked] = useState(false);
  const [activeSlot, setActiveSlot] = useState(0);
  const [displayFen, setDisplayFen] = useState(() => new Chess().fen());
  const [isAnimating, setIsAnimating] = useState(false);
  const resolutionAnimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValidFenRef = useRef<string>(new Chess().fen());
  const roomRef = useRef<Room<PredictChessState> | null>(null);
  const autoConfirmRoundRef = useRef<number>(-1);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [pickFrom, setPickFrom] = useState<Square | null>(null);
  /** Bumps on every Colyseus state patch so React re-reads nested ArraySchemas (history). */
  const [stateSyncVersion, setStateSyncVersion] = useState(0);
  const prevPhaseRef = useRef<string>("lobby");
  const prevRoundRef = useRef<number>(0);
  const draftTimer = useRef<number | null>(null);

  const orientation = myColor === "b" ? "black" : "white";

  roomRef.current = room;

  const applyState = useCallback((s: PredictChessState, sessionId: string) => {
    const nextPhase = s.phase ?? "lobby";
    const nextRound = s.roundIndex ?? 0;
    const prevPhase = prevPhaseRef.current;
    const prevRound = prevRoundRef.current;
    prevPhaseRef.current = nextPhase;
    prevRoundRef.current = nextRound;

    setPhase(s.phase ?? "lobby");
    if (s.fen) {
      setServerFen(s.fen);
      lastValidFenRef.current = s.fen;
    }
    setTimerMs(s.timerMs ?? 0);
    setWinner(s.winner ?? "");
    setRoundIndex(nextRound);
    const slots = Math.max(1, Math.min(5, Math.floor(Number(s.predictiveSlots ?? 3) || 0)));
    setSlotCount(slots);

    // First Colyseus sync can omit nested Schema fields briefly ("refId" hydration).
    const players = s.players;
    setPlayersCount(players?.size ?? 0);
    if (!players) return;

    const me = [...players.values()].find((p) => p.sessionId === sessionId);
    if (me?.color === "white") setMyColor("w");
    else if (me?.color === "black") setMyColor("b");

    if (nextPhase === "planning") {
      const wm = s.whiteMoves?.toArray?.() ?? [];
      const bm = s.blackMoves?.toArray?.() ?? [];
      const raw = me?.color === "black" ? bm : wm;
      // New planning phase: reset local plan to empty, aligned to fresh serverFen.
      const isNewPlanning = prevPhase !== "planning" || nextRound !== prevRound;
      setPlan(isNewPlanning ? makeEmptyPlan(slots) : planFromState(raw, slots));
      if (isNewPlanning) {
        setActiveSlot(0);
        setPickFrom(null);
        setHistoryCursor(null);
        autoConfirmRoundRef.current = -1;
      }
      if (me?.color === "white") setLocked(s.whiteLocked);
      else if (me?.color === "black") setLocked(s.blackLocked);
    }

    if (nextPhase === "planning" || nextPhase === "lobby") {
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
        predictiveSlots?: number;
      },
      sessionId: string
    ) => {
      if (!msg) return;
      const nextPhase = msg.phase ?? "lobby";
      const nextRound = msg.roundIndex ?? 0;
      const prevPhase = prevPhaseRef.current;
      const prevRound = prevRoundRef.current;
      prevPhaseRef.current = nextPhase;
      prevRoundRef.current = nextRound;

      setPhase(nextPhase);
      if (msg.fen) {
        setServerFen(msg.fen);
        lastValidFenRef.current = msg.fen;
        if (nextPhase === "planning" || nextPhase === "lobby") setDisplayFen(msg.fen);
      }
      setTimerMs(msg.timerMs ?? 0);
      setWinner(msg.winner ?? "");
      setRoundIndex(nextRound);
      const slots = Math.max(1, Math.min(5, Math.floor(Number(msg.predictiveSlots ?? slotCount) || 0)));
      setSlotCount(slots);
      const players: Array<{ sessionId: string; color: string; connected: boolean }> =
        msg.players ?? [];
      setPlayersCount(players.length);
      const me = players.find((p) => p.sessionId === sessionId);
      if (me?.color === "white") setMyColor("w");
      else if (me?.color === "black") setMyColor("b");
      if (me?.color === "white") setLocked(!!msg.whiteLocked);
      if (me?.color === "black") setLocked(!!msg.blackLocked);

      if (nextPhase === "planning") {
        const isNewPlanning = prevPhase !== "planning" || nextRound !== prevRound;
        if (isNewPlanning) {
          setPlan(makeEmptyPlan(slots));
          setActiveSlot(0);
          setPickFrom(null);
          setHistoryCursor(null);
          autoConfirmRoundRef.current = -1;
        }
      }
    },
    [slotCount]
  );

  useEffect(() => {
    let joined: Room<PredictChessState> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const rid = String(search.get("rid") ?? "").trim();
        const resKey = `predichess:reservation:${roomId}`;
        const reservationRaw = sessionStorage.getItem(resKey);
        if (reservationRaw) sessionStorage.removeItem(resKey);

        const r = reservationRaw
          ? await consumePredictReservationForCode(roomId, JSON.parse(reservationRaw))
          : rid
            ? await joinPredictRoomByResolvedId(roomId, rid)
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
          setStateSyncVersion((v) => v + 1);
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
      if (resolutionAnimTimer.current) clearTimeout(resolutionAnimTimer.current);
    };
  }, [roomId, search, applyState, applyStatus]);

  useLayoutEffect(() => {
    if (!room?.state || phase !== "resolution") {
      if (phase !== "resolution") setIsAnimating(false);
      return;
    }
    if (resolutionAnimTimer.current) {
      clearTimeout(resolutionAnimTimer.current);
      resolutionAnimTimer.current = null;
    }

    const steps = room.state.lastResolutionSteps?.toArray?.() ?? [];
    const rounds = room.state.resolvedRounds?.toArray?.() ?? [];
    const lastRound = rounds[rounds.length - 1];
    const fenBeforeRound =
      (lastRound?.fenBefore ?? "").trim() || lastValidFenRef.current || room.state.fen;

    const changes: string[] = [];
    let prev = fenBeforeRound;
    for (const s of steps) {
      const w = (s.fenAfterWhite ?? "").trim();
      if (w && w !== prev) {
        changes.push(w);
        prev = w;
      }
      const a = (s.fenAfter ?? "").trim();
      if (a && a !== prev) {
        changes.push(a);
        prev = a;
      }
    }

    setIsAnimating(true);
    setDisplayFen(fenBeforeRound);

    let idx = 0;
    const tick = () => {
      const r = roomRef.current;
      if (!r?.state || r.state.phase !== "resolution") {
        setIsAnimating(false);
        return;
      }
      if (idx >= changes.length) {
        setIsAnimating(false);
        setDisplayFen(r.state.fen);
        setHistoryCursor(null);
        resolutionAnimTimer.current = null;
        return;
      }
      setDisplayFen(changes[idx]);
      idx += 1;
      resolutionAnimTimer.current = window.setTimeout(tick, RESOLUTION_STEP_MS);
    };
    resolutionAnimTimer.current = window.setTimeout(tick, RESOLUTION_STEP_MS);

    return () => {
      if (resolutionAnimTimer.current) {
        clearTimeout(resolutionAnimTimer.current);
        resolutionAnimTimer.current = null;
      }
    };
  }, [phase, room, roundIndex]);

  // (planning reset is handled inside applyState/applyStatus on phase transition)

  function computePlanningFen(baseFen: string, nextPlan: Planned[], color: Color): string {
    let fen = baseFen;
    for (const m of nextPlan) {
      if (!m.from || !m.to) continue;
      const found = findVerboseMoveTo(fen, m.from, m.to, color);
      if (!found) break;
      const step = new Chess();
      step.load(withFenTurn(fen, color));
      const res = step.move({ from: m.from, to: found.to, promotion: found.promotion });
      if (!res) break;
      fen = step.fen();
    }
    return fen;
  }

  function fenBeforeSlot(baseFen: string, nextPlan: Planned[], color: Color, slotIndex: number): string {
    return computePlanningFen(baseFen, nextPlan.slice(0, Math.max(0, slotIndex)), color);
  }

  const planningFen = useMemo(() => {
    if (phase !== "planning" || !myColor) return serverFen;
    return computePlanningFen(serverFen, plan, myColor);
  }, [phase, myColor, serverFen, plan]);

  const boardFen = phase === "planning" ? planningFen : displayFen;

  const inCheckAtStart = useMemo(() => {
    if (!myColor) return false;
    return isInCheckForSide(serverFen, myColor);
  }, [serverFen, myColor]);

  const inCheckAfterPlan = useMemo(() => {
    if (!myColor) return false;
    return isInCheckForSide(planningFen, myColor);
  }, [planningFen, myColor]);

  const canEditPlan =
    phase === "planning" && myColor && !locked && timerMs > 0;

  useEffect(() => {
    setActiveSlot((cur) => {
      const max = Math.max(0, slotCount - 1);
      return Math.min(Math.max(0, cur), max);
    });
  }, [slotCount]);

  useEffect(() => {
    setPickFrom(null);
  }, [activeSlot]);

  // Send draft plan to server (for auto-confirm on timeout).
  useEffect(() => {
    if (!room || !canEditPlan || !myColor) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      const moves = plan.map((p) =>
        p.from && p.to ? { from: p.from, to: p.to } : { from: "", to: "" }
      );
      room.send("draft_plan", { moves });
    }, 220);
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
    };
  }, [plan, room, canEditPlan, myColor]);

  const historyFens = useMemo(() => {
    const rounds = readArraySchema<RoundSnapshot>(room?.state?.resolvedRounds);
    const out: string[] = [];
    for (const r of rounds) {
      const steps = readArraySchema<StepSnapshot>(r.steps);
      for (const s of steps) {
        if (s?.fenAfter) out.push(s.fenAfter);
      }
    }
    return out;
  }, [room, stateSyncVersion]);

  const resolvedRoundsList = useMemo(
    () => readArraySchema<RoundSnapshot>(room?.state?.resolvedRounds),
    [room, stateSyncVersion]
  );

  const historyLogList = useMemo(
    () => readArraySchema<string>(room?.state?.historyLog),
    [room, stateSyncVersion]
  );

  const viewingHistory =
    historyCursor != null && historyCursor >= 0 && historyCursor < historyFens.length;
  const rawBoardFen = viewingHistory ? historyFens[historyCursor!] : boardFen;
  const effectiveBoardFen =
    rawBoardFen && rawBoardFen.trim() ? rawBoardFen : lastValidFenRef.current;

  const baseFenActiveSlot = useMemo(() => {
    if (!myColor) return serverFen;
    return fenBeforeSlot(serverFen, plan, myColor, activeSlot);
  }, [serverFen, plan, myColor, activeSlot]);

  const legalTargetsForPick = useMemo(() => {
    if (!pickFrom || !myColor || phase !== "planning") return new Set<string>();
    return new Set(getLegalTargetsForPlanning(baseFenActiveSlot, pickFrom, myColor));
  }, [pickFrom, myColor, phase, baseFenActiveSlot]);

  const customSquareStyles = useMemo(() => {
    const st: Record<string, import("react").CSSProperties> = {};
    if (!pickFrom || phase !== "planning" || !canEditPlan || viewingHistory) return st;
    st[pickFrom] = { backgroundColor: "rgba(255, 220, 80, 0.35)" };
    const dot =
      "radial-gradient(circle, rgba(0,0,0,0.55) 22%, transparent 24%), radial-gradient(circle, rgba(255,255,255,0.2) 22%, transparent 24%)";
    for (const sq of legalTargetsForPick) {
      if (sq === pickFrom) continue;
      st[sq] = {
        background: dot,
        backgroundColor: "rgba(120, 180, 255, 0.12)",
        backgroundPosition: "center",
        backgroundSize: "100% 100%",
      };
    }
    return st;
  }, [pickFrom, phase, canEditPlan, viewingHistory, legalTargetsForPick]);

  const goHistoryBack = useCallback(() => {
    if (historyFens.length === 0) return;
    setHistoryCursor((cur) => {
      const next = cur == null ? historyFens.length - 1 : Math.max(0, cur - 1);
      return next;
    });
  }, [historyFens.length]);

  const goHistoryForward = useCallback(() => {
    if (historyFens.length === 0) return;
    setHistoryCursor((cur) => {
      if (cur == null) return null;
      const next = cur + 1;
      return next >= historyFens.length ? null : next;
    });
  }, [historyFens.length]);

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goHistoryBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goHistoryForward();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goHistoryBack, goHistoryForward]);

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
    const slot = plan[activeSlot];
    if (slot.from && slot.to) {
      return false;
    }
    const baseFen = fenBeforeSlot(serverFen, plan, myColor, activeSlot);
    const legal = isMoveLegalForSide(baseFen, sourceSquare, targetSquare, myColor);
    if (!legal) return false;

    setPlan((prev) => {
      const next = prev.map((p) => ({ ...p }));
      next[activeSlot] = { from: sourceSquare, to: targetSquare };
      const nextEmpty = findNextEmptySlot(next, activeSlot + 1);
      if (nextEmpty != null) setActiveSlot(nextEmpty);
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
    if (!room || !canEditPlan || viewingHistory) return;
    if (phase === "planning" && myColor && inCheckAtStart) {
      const hasAnyMove = plan.some((p) => !!(p.from && p.to));
      if (!hasAnyMove) {
        setToast("Sei in scacco: devi fare almeno una mossa per parare lo scacco");
        return;
      }
    }
    const moves = plan.map((p) =>
      p.from && p.to ? { from: p.from, to: p.to } : { from: "", to: "" }
    );
    room.send("submit_plan", { moves });
    setLocked(true);
  }

  useEffect(() => {
    if (!room || !canEditPlan || !myColor || viewingHistory || locked) return;
    if (phase !== "planning") return;
    const full = plan.every((p) => !!(p.from && p.to));
    if (!full) return;
    if (autoConfirmRoundRef.current === roundIndex) return;
    if (inCheckAtStart) {
      const hasAnyMove = plan.some((p) => !!(p.from && p.to));
      if (!hasAnyMove) return;
    }
    autoConfirmRoundRef.current = roundIndex;
    const moves = plan.map((p) =>
      p.from && p.to ? { from: p.from, to: p.to } : { from: "", to: "" }
    );
    room.send("submit_plan", { moves });
    setLocked(true);
  }, [
    plan,
    room,
    canEditPlan,
    myColor,
    viewingHistory,
    locked,
    phase,
    roundIndex,
    inCheckAtStart,
  ]);

  const slotsUi = useMemo(() => plan, [plan]);

  const lobbyWait =
    phase === "lobby" &&
    room?.state?.players != null &&
    room.state.players.size < 2;

  const myLabel =
    myColor === "w" ? "Bianco" : myColor === "b" ? "Nero" : "—";

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col px-3 pb-8 pt-6">
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
        <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">In attesa di un avversario…</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Condividi questo codice o un link di invito.
              </p>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-200">
              Lobby
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2">
              <div className="text-[10px] text-slate-500">Codice stanza</div>
              <div className="font-mono text-lg text-white">{roomId}</div>
            </div>
            <button
              type="button"
              className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-900/40 ring-1 ring-white/10 transition hover:bg-indigo-500 active:scale-[0.99]"
              onClick={async () => {
                const url = `${window.location.origin}/?room=${encodeURIComponent(roomId)}&guest=1`;
                try {
                  await navigator.clipboard.writeText(url);
                  setToast("Link copiato");
                } catch {
                  try {
                    // Fallback: select+copy via prompt
                    window.prompt("Copia il link:", url);
                  } finally {
                    setToast("Link pronto");
                  }
                }
              }}
            >
              Copia Link di Invito
            </button>
          </div>
        </div>
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

      {phase === "planning" && myColor && (inCheckAtStart || inCheckAfterPlan) && (
        <div
          className={`mb-3 rounded-2xl border px-4 py-3 text-sm ${
            inCheckAfterPlan
              ? "border-rose-500/30 bg-rose-950/30 text-rose-100"
              : "border-emerald-500/30 bg-emerald-950/30 text-emerald-100"
          }`}
        >
          {inCheckAfterPlan ? (
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Sei in scacco</div>
                <div className="mt-1 text-[12px] opacity-90">
                  Devi pianificare una mossa legale per parare lo scacco (non puoi passare).
                </div>
              </div>
              <span className="rounded-full border border-rose-500/30 bg-rose-950/40 px-3 py-1 text-[11px]">
                Check
              </span>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Scacco parato nel piano</div>
                <div className="mt-1 text-[12px] opacity-90">
                  La tua sequenza attuale esce dallo scacco.
                </div>
              </div>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-950/40 px-3 py-1 text-[11px]">
                OK
              </span>
            </div>
          )}
        </div>
      )}

      {phase === "resolution" && (
        <p className="mb-3 text-center text-sm text-slate-400">
          Risoluzione — round {roundIndex + 1}
          {isAnimating ? " · animazione" : ""}
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

      <div className="mt-1 flex w-full flex-col gap-3 lg:flex-row lg:items-start lg:justify-center">
        <div className="w-full max-w-[min(100vw-24px,420px)] self-center">
          <Chessboard
            options={{
              position: effectiveBoardFen,
              boardOrientation: orientation,
              animationDurationInMs: BOARD_ANIM_MS,
              squareStyles: customSquareStyles,
              allowDragging: !!canEditPlan && !viewingHistory,
              onSquareClick: ({ square }) => {
                const sq = square as Square;
                if (!canEditPlan || !myColor || viewingHistory) return;
                const base = fenBeforeSlot(serverFen, plan, myColor, activeSlot);
                const c = forkForSide(base, myColor);
                if (!pickFrom) {
                  const piece = c.get(sq);
                  if (piece && piece.color === myColor) setPickFrom(sq);
                  return;
                }
                if (sq === pickFrom) {
                  setPickFrom(null);
                  return;
                }
                const onDest = c.get(sq);
                if (onDest && onDest.color === myColor) {
                  setPickFrom(sq);
                  return;
                }
                if (legalTargetsForPick.has(sq)) {
                  const ok = onPieceDrop(pickFrom, sq);
                  if (ok) setPickFrom(null);
                  return;
                }
                setPickFrom(null);
              },
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!targetSquare) return false;
                return onPieceDrop(sourceSquare as Square, targetSquare as Square);
              },
            }}
          />
        </div>

        <div className="w-full lg:w-80">
          <RoundHistoryPanel
            rounds={resolvedRoundsList}
            historyLines={historyLogList}
            cursor={historyCursor}
            totalFens={historyFens.length}
            onBack={goHistoryBack}
            onForward={goHistoryForward}
            onSelectFen={(fen) => {
              const idx = historyFens.findLastIndex((f) => f === fen);
              if (idx >= 0) setHistoryCursor(idx);
            }}
          />
        </div>
      </div>

      {viewingHistory && (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Modalità storico: input mosse disabilitato ({historyCursor! + 1}/{historyFens.length})
        </p>
      )}

      {phase === "planning" && myColor && (
        <>
          <p className="mt-4 text-center text-xs text-slate-500">
            Sei {myColor === "w" ? "Bianco" : "Nero"} — slot attivo:{" "}
            {activeSlot + 1}
          </p>

          <div
            className="mt-3 grid gap-2"
            style={{ gridTemplateColumns: `repeat(${slotCount}, minmax(0, 1fr))` }}
          >
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

function RoundHistoryPanel({
  rounds,
  historyLines,
  cursor,
  totalFens,
  onBack,
  onForward,
  onSelectFen,
}: {
  rounds: Array<{
    roundIndex: number;
    fenBefore: string;
    fenAfter: string;
    steps?:
      | {
          toArray?: () => Array<{ fenAfter: string; whiteMove: string; blackMove: string }>;
        }
      | Array<{ fenAfter: string; whiteMove: string; blackMove: string }>;
  }>;
  historyLines: string[];
  cursor: number | null;
  totalFens: number;
  onBack: () => void;
  onForward: () => void;
  onSelectFen: (fen: string) => void;
}) {
  const canBack = totalFens > 0;
  const canForward = totalFens > 0 && cursor != null;
  const modeLabel =
    totalFens === 0
      ? ""
      : cursor == null
        ? "Live"
        : `Storico: ${Math.min(totalFens, cursor + 1)}/${totalFens}`;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Round precedenti</h2>
          {modeLabel && <span className="text-[11px] text-slate-500">{modeLabel}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-slate-900 text-sm text-slate-200 disabled:opacity-30"
            onClick={onBack}
            disabled={!canBack}
            aria-label="Storico indietro (freccia sinistra)"
            title="Indietro (←)"
          >
            ←
          </button>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-slate-900 text-sm text-slate-200 disabled:opacity-30"
            onClick={onForward}
            disabled={!canForward}
            aria-label="Storico avanti (freccia destra)"
            title="Avanti (→)"
          >
            →
          </button>
          <span className="text-[11px] text-slate-500">{rounds.length}</span>
        </div>
      </div>
      {historyLines.length > 0 && (
        <div className="mt-3 max-h-[28dvh] space-y-1.5 overflow-auto rounded-xl border border-white/5 bg-slate-900/50 p-2 lg:max-h-[min(36dvh,420px)]">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Log partita
          </div>
          {historyLines.map((line, i) => (
            <p key={i} className="text-[11px] leading-snug text-slate-400">
              {line}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 max-h-[40dvh] space-y-2 overflow-auto pr-1 lg:max-h-[min(62dvh,640px)]">
        {rounds.length === 0 && (
          <p className="text-xs text-slate-500">Nessuna risoluzione ancora.</p>
        )}
        {rounds.map((r, ri) => {
          const steps = readArraySchema<StepSnapshot>(r.steps);
          const movesText = steps
            .map((s, i) => {
              const w = s.whiteMove
                ? `Bianco ${s.whiteMove.slice(0, 2)}→${s.whiteMove.slice(2)}`
                : "Bianco —";
              const b = s.blackMove
                ? `Nero ${s.blackMove.slice(0, 2)}→${s.blackMove.slice(2)}`
                : "Nero —";
              return `S${i + 1}: ${w}, ${b}`;
            })
            .join(" · ");
          const lastFen = steps.length ? steps[steps.length - 1].fenAfter : r.fenAfter;
          return (
            <button
              key={ri}
              type="button"
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-left text-xs"
              onClick={() => onSelectFen(lastFen)}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-slate-200">Round {r.roundIndex + 1}</span>
                <span className="text-slate-500">vai</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">{movesText || "—"}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
