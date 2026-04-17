import { Chess, type Square, type Color } from "chess.js";

const EMPTY: PlannedMoveInput = { from: "", to: "" };

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
  const toN = normalizeCastleTarget(fen, from, to, color);
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return false;
  const moves = c.moves({ square: from, verbose: true });
  if (moves.some((m) => m.to === toN)) return true;
  const target = c.get(toN);
  if (target && target.color === color) {
    c.remove(toN);
    const moves2 = c.moves({ square: from, verbose: true });
    return moves2.some((m) => m.to === toN);
  }
  return false;
}

function kingCaptureWinner(fen: string): "white" | "black" | "draw" | null {
  const c = new Chess();
  c.load(fen);
  const wk = c.findPiece({ type: "k", color: "w" });
  const bk = c.findPiece({ type: "k", color: "b" });
  if (wk.length === 0 && bk.length > 0) return "black";
  if (bk.length === 0 && wk.length > 0) return "white";
  if (wk.length === 0 && bk.length === 0) return "draw";
  return null;
}

function applySanMove(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): { fen: string; capture?: string } | null {
  const toN = normalizeCastleTarget(fen, from, to, color);
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return null;
  const moves = c.moves({ square: from, verbose: true });
  let found = moves.find((m) => m.to === toN);
  if (!found) {
    const target = c.get(toN);
    if (target && target.color === color) {
      c.remove(toN);
      const moves2 = c.moves({ square: from, verbose: true });
      found = moves2.find((m) => m.to === toN);
    }
  }
  if (!found) return null;
  const result = c.move({ from, to: toN, promotion: found.promotion });
  if (!result) return null;
  const capture = result.captured
    ? `${color}:${result.captured}@${result.to}`
    : undefined;
  return { fen: c.fen(), capture };
}

export type ResolutionStepResult = {
  fenAfter: string;
  fenBeforeStep: string;
  /** FEN after White's half-move; empty if White passed or move not applied. */
  fenAfterWhite: string;
  gameOver: boolean;
  winner: "" | "white" | "black" | "draw";
  collision: boolean;
  captures: string[];
  whiteApplied: boolean;
  blackApplied: boolean;
};

/**
 * One step with priority: validate+apply White first, then validate+apply Black on updated FEN.
 * Invalid moves are silently discarded (but reported via whiteApplied/blackApplied).
 */
export function resolveOneStep(
  fenBefore: string,
  white: PlannedMoveInput,
  black: PlannedMoveInput
): ResolutionStepResult {
  let fen = fenBefore;
  const fenBeforeStep = fenBefore;
  let fenAfterWhite = "";
  const wPass = isPass(white);
  const bPass = isPass(black);

  const wf = wPass ? null : normalizeSquare(white.from)!;
  const wt = wPass ? null : normalizeSquare(white.to)!;
  const bf = bPass ? null : normalizeSquare(black.from)!;
  const bt = bPass ? null : normalizeSquare(black.to)!;

  let collision = false;
  const captures: string[] = [];
  let whiteApplied = false;
  let blackApplied = false;

  if (!wPass && wf && wt) {
    const wTo = normalizeCastleTarget(fen, wf, wt, "w");
    const wLegal = isMoveLegalForSide(fen, wf, wTo, "w");
    if (wLegal) {
      const next = applySanMove(fen, wf, wTo, "w");
      if (next?.fen) {
        fen = next.fen;
        whiteApplied = true;
        fenAfterWhite = fen;
        if (next.capture) captures.push(next.capture);
      }
    }
  }

  const mid = kingCaptureWinner(fen);
  if (mid) {
    return {
      fenAfter: fen,
      fenBeforeStep,
      fenAfterWhite,
      gameOver: true,
      winner: mid,
      collision,
      captures,
      whiteApplied,
      blackApplied,
    };
  }

  if (!bPass && bf && bt) {
    const bTo = normalizeCastleTarget(fen, bf, bt, "b");
    const bLegal = isMoveLegalForSide(fen, bf, bTo, "b");
    if (bLegal) {
      const next = applySanMove(fen, bf, bTo, "b");
      if (next?.fen) {
        fen = next.fen;
        blackApplied = true;
        if (next.capture) captures.push(next.capture);
      }
    }
  }

  const end = kingCaptureWinner(fen);
  if (end) {
    return {
      fenAfter: fen,
      fenBeforeStep,
      fenAfterWhite,
      gameOver: true,
      winner: end,
      collision,
      captures,
      whiteApplied,
      blackApplied,
    };
  }

  return {
    fenAfter: fen,
    fenBeforeStep,
    fenAfterWhite,
    gameOver: false,
    winner: "",
    collision,
    captures,
    whiteApplied,
    blackApplied,
  };
}

export function padMoves(moves: PlannedMoveInput[]): PlannedMoveInput[] {
  return padMovesN(moves, 5);
}

export function padMovesN(moves: PlannedMoveInput[], slots: number): PlannedMoveInput[] {
  const n = Math.max(1, Math.min(5, Math.floor(slots || 0)));
  const out = moves.slice(0, n);
  while (out.length < n) out.push({ ...EMPTY });
  return out;
}

/** True if `color`'s king is in check in `fen` (ignores whose turn it is in the FEN). */
export function isSideInCheck(fen: string, color: Color): boolean {
  return forkForSide(fen, color).inCheck();
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
  const c = new Chess();
  c.load(fen);
  if (!c.inCheck()) return null;

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
