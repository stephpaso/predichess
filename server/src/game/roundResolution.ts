import type { PlannedMoveInput } from "./resolver.js";
import { padMovesN, resolveOneStep } from "./resolver.js";
import {
  firstMoverForStep,
  spendBidTokens,
  type InitiativeBid,
} from "./initiative.js";
import { RoundSnapshot, StepSnapshot } from "../schema/PredictChessState.js";

export type RevealedStep = {
  fenAfter: string;
  fenAfterWhite: string;
  fenAfterFirst: string;
  whiteMove: string;
  blackMove: string;
  whiteApplied: boolean;
  blackApplied: boolean;
  collision: boolean;
  captures: string[];
  firstMover: "white" | "black";
  whiteBidAmount: number;
  blackBidAmount: number;
  gameOver: boolean;
  winner: "" | "white" | "black" | "draw";
};

function moveLabel(m: PlannedMoveInput | undefined): string {
  return m?.from && m?.to ? `${m.from}${m.to}` : "";
}

function bidOnStep(bid: InitiativeBid | null, step: number): number {
  if (!bid || bid.amount <= 0 || bid.slot !== step) return 0;
  return bid.amount;
}

/**
 * Spend locked bids once, then resolve each slot in priority order.
 * Does not throw if a king disappears.
 */
export function resolvePlannedRound(args: {
  fen: string;
  roundIndex: number;
  slots: number;
  whiteMoves: PlannedMoveInput[];
  blackMoves: PlannedMoveInput[];
  whiteBid: InitiativeBid | null;
  blackBid: InitiativeBid | null;
  whiteTokens: number;
  blackTokens: number;
}): {
  fen: string;
  steps: RevealedStep[];
  whiteTokens: number;
  blackTokens: number;
  winner: "" | "white" | "black" | "draw";
} {
  const slots = Math.max(1, Math.min(5, Math.floor(args.slots || 0) || 1));
  const wm = padMovesN(args.whiteMoves, slots);
  const bm = padMovesN(args.blackMoves, slots);
  const spent = spendBidTokens(args.whiteTokens, args.blackTokens, args.whiteBid, args.blackBid);
  let fen = args.fen;
  const steps: RevealedStep[] = [];
  let winner: "" | "white" | "black" | "draw" = "";

  for (let i = 0; i < slots; i++) {
    const first = firstMoverForStep(
      args.roundIndex,
      i,
      args.whiteBid,
      args.blackBid,
      spent.whiteTokens,
      spent.blackTokens
    );
    const step = resolveOneStep(fen, wm[i]!, bm[i]!, first);
    fen = step.fenAfter;
    const row: RevealedStep = {
      fenAfter: step.fenAfter,
      fenAfterWhite: step.fenAfterWhite ?? "",
      fenAfterFirst: step.fenAfterFirst || step.fenAfter,
      whiteMove: moveLabel(wm[i]),
      blackMove: moveLabel(bm[i]),
      whiteApplied: !!step.whiteApplied,
      blackApplied: !!step.blackApplied,
      collision: !!step.collision,
      captures: [...(step.captures ?? [])],
      firstMover: first === "b" ? "black" : "white",
      whiteBidAmount: bidOnStep(args.whiteBid, i),
      blackBidAmount: bidOnStep(args.blackBid, i),
      gameOver: !!step.gameOver,
      winner: step.winner || "",
    };
    steps.push(row);
    if (step.gameOver && step.winner) {
      winner = step.winner;
      break;
    }
  }

  return {
    fen,
    steps,
    whiteTokens: spent.whiteTokens,
    blackTokens: spent.blackTokens,
    winner,
  };
}

function fillStep(target: StepSnapshot, row: RevealedStep) {
  target.fenAfter = row.fenAfter;
  target.fenAfterWhite = row.fenAfterWhite;
  target.fenAfterFirst = row.fenAfterFirst;
  target.whiteMove = row.whiteMove;
  target.blackMove = row.blackMove;
  target.whiteApplied = row.whiteApplied;
  target.blackApplied = row.blackApplied;
  target.collision = row.collision;
  target.captures.clear();
  for (const c of row.captures) target.captures.push(c);
  target.firstMover = row.firstMover;
  target.whiteBidAmount = row.whiteBidAmount;
  target.blackBidAmount = row.blackBidAmount;
}

/** Clone each step into both the live animation list and the persisted round. */
export function appendResolvedSteps(
  lastResolutionSteps: { clear: () => void; push: (s: StepSnapshot) => void },
  round: RoundSnapshot,
  steps: RevealedStep[]
) {
  lastResolutionSteps.clear();
  for (const row of steps) {
    const snap = new StepSnapshot();
    fillStep(snap, row);
    lastResolutionSteps.push(snap);
    const hist = new StepSnapshot();
    fillStep(hist, row);
    round.steps.push(hist);
  }
}
