import { Chess, type Square, type Color } from "chess.js";
import { fenAfterManualMove, kingCaptureWinner } from "./kings.js";

const EMPTY: PlannedMoveInput = { from: "", to: "" };

export type FirstColor = "w" | "b";

export type PlannedMoveInput = { from: string; to: string };

function withFenTurn(fen: string, color: Color): string {
  // FEN: "board activeColor castling ep halfmove fullmove"
  // Align side to move for chess.js; if we flip turn, clear ep — it only applies to the
  // original active color (chess.js: "illegal en-passant square" otherwise).
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return fen;
  if (parts[1] === color) return fen;
  parts[1] = color;
  if (parts.length > 3) parts[3] = "-";
  return parts.join(" ");
}

function normalizeSquare(s: string): Square | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  if (!/^[a-h][1-8]$/.test(t)) return null;
  return t as Square;
}

function isPass(m: PlannedMoveInput): boolean {
  return !normalizeSquare(m.from) || !normalizeSquare(m.to);
}

/** Chess.js only lists moves for the side to move; align turn for validation. */
function forkForSide(fen: string, color: Color): Chess {
  const c = new Chess();
  c.load(withFenTurn(fen, color));
  return c;
}

function tryFork(fen: string, color: Color): Chess | null {
  try {
    return forkForSide(fen, color);
  } catch {
    return null;
  }
}

function isOwnKing(c: Chess, square: Square, color: Color): boolean {
  const target = c.get(square);
  return !!target && target.type === "k" && target.color === color;
}

function isEnemyKing(c: Chess, square: Square, color: Color): boolean {
  const target = c.get(square);
  return !!target && target.type === "k" && target.color !== color;
}

function pieceAttacksSquare(c: Chess, from: Square, to: Square, color: Color): boolean {
  try {
    return c.attackers(to, color).includes(from);
  } catch {
    return false;
  }
}

/**
 * If king is dropped on own rook, map to the king's castling destination (g1/c1/g8/c8).
 */
export function normalizeCastleTarget(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): Square {
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.type !== "k" || piece.color !== color) return to;
  const atTo = c.get(to);
  if (!atTo || atTo.type !== "r" || atTo.color !== color) return to;
  const moves = c.moves({ square: from, verbose: true });
  if (moves.some((m) => m.to === to)) return to;
  const castles = moves.filter((m) => /[kq]/.test(m.flags ?? ""));
  for (const m of castles) {
    if (color === "w" && to === "h1" && m.flags.includes("k")) return m.to;
    if (color === "w" && to === "a1" && m.flags.includes("q")) return m.to;
    if (color === "b" && to === "h8" && m.flags.includes("k")) return m.to;
    if (color === "b" && to === "a8" && m.flags.includes("q")) return m.to;
  }
  return castles[0]?.to ?? to;
}

export function isMoveLegalForSide(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): boolean {
  try {
    const toN = normalizeCastleTarget(fen, from, to, color);
    const c = forkForSide(fen, color);
    const piece = c.get(from);
    if (!piece || piece.color !== color) return false;
    if (isOwnKing(c, toN, color)) return false;
    const moves = c.moves({ square: from, verbose: true });
    if (moves.some((m) => m.to === toN)) return true;
    const target = c.get(toN);
    if (target && target.color === color && target.type !== "k") {
      c.remove(toN);
      const moves2 = c.moves({ square: from, verbose: true });
      return moves2.some((m) => m.to === toN);
    }
    // Enemy king: chess.js omits the capture when the mover is in check.
    // The piece still takes the king if it attacks the square; the game ends immediately.
    if (isEnemyKing(c, toN, color) && pieceAttacksSquare(c, from, toN, color)) return true;
    return false;
  } catch {
    return false;
  }
}

function applyKingCapture(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): { fen: string; capture?: string } | null {
  const c = tryFork(fen, color);
  if (!c || !isEnemyKing(c, to, color) || !pieceAttacksSquare(c, from, to, color)) return null;
  const piece = c.get(from);
  let promotion: string | undefined;
  if (piece?.type === "p") {
    const rank = to[1];
    if ((color === "w" && rank === "8") || (color === "b" && rank === "1")) promotion = "q";
  }
  const next = fenAfterManualMove(fen, from, to, color, promotion);
  if (!next) return null;
  return { fen: next, capture: `${color}:k@${to}` };
}

function applySanMove(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): { fen: string; capture?: string } | null {
  try {
    const toN = normalizeCastleTarget(fen, from, to, color);
    const c = forkForSide(fen, color);
    const piece = c.get(from);
    if (!piece || piece.color !== color) return null;
    if (isOwnKing(c, toN, color)) return null;
    const moves = c.moves({ square: from, verbose: true });
    let found = moves.find((m) => m.to === toN);
    if (!found) {
      const target = c.get(toN);
      if (target && target.color === color && target.type !== "k") {
        c.remove(toN);
        const moves2 = c.moves({ square: from, verbose: true });
        found = moves2.find((m) => m.to === toN);
      }
    }
    if (!found) {
      if (isEnemyKing(c, toN, color)) return applyKingCapture(fen, from, toN, color);
      return null;
    }
    const result = c.move({ from, to: toN, promotion: found.promotion });
    if (!result) return null;
    const capture = result.captured
      ? `${color}:${result.captured}@${result.to}`
      : undefined;
    // fen() is safe with a missing king; Chess.load is not. Do not reload here.
    return { fen: c.fen(), capture };
  } catch {
    return null;
  }
}

export type ResolutionStepResult = {
  fenAfter: string;
  fenBeforeStep: string;
  /** FEN after White's half-move; empty if White passed or the move was not applied. */
  fenAfterWhite: string;
  /** FEN after the first mover's half-move (priority order, not color order). */
  fenAfterFirst: string;
  firstMover: "white" | "black";
  gameOver: boolean;
  winner: "" | "white" | "black" | "draw";
  collision: boolean;
  captures: string[];
  whiteApplied: boolean;
  blackApplied: boolean;
};

function stepResult(
  partial: Omit<ResolutionStepResult, "collision"> & { collision?: boolean }
): ResolutionStepResult {
  return { collision: false, ...partial };
}

/**
 * One step with an explicit first mover: validate+apply `first`, then the other side
 * on the updated FEN. Invalid moves are discarded. King checks never throw.
 * If both plans would capture a king, the first mover's capture stands and wins.
 */
export function resolveOneStep(
  fenBefore: string,
  white: PlannedMoveInput,
  black: PlannedMoveInput,
  first: FirstColor = "w"
): ResolutionStepResult {
  let fen = fenBefore;
  const fenBeforeStep = fenBefore;
  let fenAfterWhite = "";
  let fenAfterFirst = fenBefore;
  const priority: FirstColor = first === "b" ? "b" : "w";
  const firstMover = priority === "b" ? "black" : "white";
  const wPass = isPass(white);
  const bPass = isPass(black);

  const wf = wPass ? null : normalizeSquare(white.from)!;
  const wt = wPass ? null : normalizeSquare(white.to)!;
  const bf = bPass ? null : normalizeSquare(black.from)!;
  const bt = bPass ? null : normalizeSquare(black.to)!;

  const captures: string[] = [];
  let whiteApplied = false;
  let blackApplied = false;

  const applySide = (color: Color) => {
    const pass = color === "w" ? wPass : bPass;
    const from = color === "w" ? wf : bf;
    const to = color === "w" ? wt : bt;
    if (pass || !from || !to) return;
    const toN = normalizeCastleTarget(fen, from, to, color);
    if (!isMoveLegalForSide(fen, from, toN, color)) return;
    const next = applySanMove(fen, from, toN, color);
    if (!next?.fen) return;
    fen = next.fen;
    if (color === "w") {
      whiteApplied = true;
      fenAfterWhite = fen;
    } else {
      blackApplied = true;
    }
    if (next.capture) captures.push(next.capture);
  };

  const order: Color[] = priority === "b" ? ["b", "w"] : ["w", "b"];
  applySide(order[0]);
  fenAfterFirst = fen;
  const mid = kingCaptureWinner(fen, priority);
  if (mid) {
    return stepResult({
      fenAfter: fen,
      fenBeforeStep,
      fenAfterWhite,
      fenAfterFirst,
      firstMover,
      gameOver: true,
      winner: mid,
      captures,
      whiteApplied,
      blackApplied,
    });
  }

  applySide(order[1]);
  const end = kingCaptureWinner(fen, priority);
  if (end) {
    return stepResult({
      fenAfter: fen,
      fenBeforeStep,
      fenAfterWhite,
      fenAfterFirst,
      firstMover,
      gameOver: true,
      winner: end,
      captures,
      whiteApplied,
      blackApplied,
    });
  }

  return stepResult({
    fenAfter: fen,
    fenBeforeStep,
    fenAfterWhite,
    fenAfterFirst,
    firstMover,
    gameOver: false,
    winner: "",
    captures,
    whiteApplied,
    blackApplied,
  });
}

export function padMoves(moves: PlannedMoveInput[]): PlannedMoveInput[] {
  return padMovesN(moves, 5);
}

/** Max length for a square token before normalize (DoS guard on hostile WS payloads). */
const MAX_SQUARE_TOKEN_LEN = 8;

function sanitizeMoveToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, MAX_SQUARE_TOKEN_LEN);
}

export function padMovesN(moves: PlannedMoveInput[], slots: number): PlannedMoveInput[] {
  const n = Math.max(1, Math.min(5, Math.floor(slots || 0)));
  const src = Array.isArray(moves) ? moves : [];
  const out: PlannedMoveInput[] = src.slice(0, n).map((m) => ({
    from: sanitizeMoveToken(m?.from),
    to: sanitizeMoveToken(m?.to),
  }));
  while (out.length < n) out.push({ ...EMPTY });
  return out;
}

/** True if `color`'s king is in check in `fen` (ignores whose turn it is in the FEN). */
export function isSideInCheck(fen: string, color: Color): boolean {
  const c = tryFork(fen, color);
  if (!c) return false;
  try {
    return c.inCheck();
  } catch {
    return false;
  }
}

/** Load a FEN, or null when chess.js rejects it (for example a missing king). */
export function safeLoadChess(fen: string): Chess | null {
  try {
    const c = new Chess();
    c.load(fen);
    return c;
  } catch {
    return null;
  }
}

/**
 * If the side to move starts in check, simulates only that side's planned moves in isolation.
 * Returns the losing player ("white" | "black") if they never get out of check in that sequence
 * (including empty or all-pass plans); otherwise null.
 */
export function loserForIgnoredCheckIfAny(
  fen: string,
  whiteMoves: PlannedMoveInput[],
  blackMoves: PlannedMoveInput[]
): "white" | "black" | null {
  const c = safeLoadChess(fen);
  if (!c) return null;
  let inCheck = false;
  try {
    inCheck = c.inCheck();
  } catch {
    return null;
  }
  if (!inCheck) return null;

  const turn = c.turn();
  const color: Color = turn;
  const seq = turn === "w" ? whiteMoves : blackMoves;

  let currentFen = fen;
  for (const m of seq) {
    if (isPass(m)) continue;
    const from = normalizeSquare(m.from);
    const to = normalizeSquare(m.to);
    if (!from || !to) continue;
    const next = applySanMove(currentFen, from, to, color);
    if (!next) continue;
    currentFen = next.fen;
    if (!isSideInCheck(currentFen, color)) {
      return null;
    }
  }

  return isSideInCheck(currentFen, color) ? (turn === "w" ? "white" : "black") : null;
}
