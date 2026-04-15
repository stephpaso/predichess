import { Chess, type Square, type Color } from "chess.js";

const EMPTY: PlannedMoveInput = { from: "", to: "" };

export type PlannedMoveInput = { from: string; to: string };

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
  c.load(fen);
  c.setTurn(color);
  return c;
}

export function isMoveLegalForSide(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): boolean {
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return false;
  const moves = c.moves({ square: from, verbose: true });
  return moves.some((m) => m.to === to);
}

function pieceTypeAt(fen: string, sq: Square): "k" | "other" {
  const c = new Chess();
  c.load(fen);
  const p = c.get(sq);
  if (!p) return "other";
  return p.type === "k" ? "k" : "other";
}

function applySanMove(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): { fen: string; capture?: string } | null {
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return null;
  const moves = c.moves({ square: from, verbose: true });
  const found = moves.find((m) => m.to === to);
  if (!found) return null;
  const result = c.move({ from, to, promotion: found.promotion });
  if (!result) return null;
  const capture = result.captured ? `${color}:${result.captured}@${result.to}` : undefined;
  return { fen: c.fen(), capture };
}

function applyMutualDestruction(fen: string, wFrom: Square, bFrom: Square, dest: Square): string {
  const c = new Chess();
  c.load(fen);
  c.remove(wFrom);
  c.remove(bFrom);
  if (c.get(dest)) c.remove(dest);
  return c.fen();
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

export type ResolutionStepResult = {
  fenAfter: string;
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
  const wPass = isPass(white);
  const bPass = isPass(black);

  const wf = wPass ? null : normalizeSquare(white.from)!;
  const wt = wPass ? null : normalizeSquare(white.to)!;
  const bf = bPass ? null : normalizeSquare(black.from)!;
  const bt = bPass ? null : normalizeSquare(black.to)!;

  let collision = false; // kept for UI backward-compat; sequential resolution makes it mostly irrelevant
  const captures: string[] = [];
  let whiteApplied = false;
  let blackApplied = false;

  // WHITE first
  if (!wPass && wf && wt) {
    const wLegal = isMoveLegalForSide(fen, wf, wt, "w");
    const wPiece = forkForSide(fen, "w").get(wf);
    console.log(
      `[resolveOneStep] WHITE from=${wf} to=${wt} legal=${wLegal} piece=${wPiece ? `${wPiece.color}${wPiece.type}` : "none"} fen=${fen}`
    );
    if (wLegal) {
      const next = applySanMove(fen, wf, wt, "w");
      console.log(`[resolveOneStep] WHITE move result=`, next);
      if (next?.fen) {
        fen = next.fen;
        whiteApplied = true;
        if (next.capture) captures.push(next.capture);
      }
    } else {
      console.log(`[resolveOneStep] WHITE rejected: not in moves() list`);
    }
  }

  const mid = kingCaptureWinner(fen);
  if (mid) {
    return {
      fenAfter: fen,
      gameOver: true,
      winner: mid,
      collision,
      captures,
      whiteApplied,
      blackApplied,
    };
  }

  // BLACK second, on updated fen
  if (!bPass && bf && bt) {
    const bLegal = isMoveLegalForSide(fen, bf, bt, "b");
    const bPiece = forkForSide(fen, "b").get(bf);
    console.log(
      `[resolveOneStep] BLACK from=${bf} to=${bt} legal=${bLegal} piece=${bPiece ? `${bPiece.color}${bPiece.type}` : "none"} fen=${fen}`
    );
    if (bLegal) {
      const next = applySanMove(fen, bf, bt, "b");
      console.log(`[resolveOneStep] BLACK move result=`, next);
      if (next?.fen) {
        fen = next.fen;
        blackApplied = true;
        if (next.capture) captures.push(next.capture);
      }
    } else {
      console.log(`[resolveOneStep] BLACK rejected: not in moves() list`);
    }
  }

  const end = kingCaptureWinner(fen);
  if (end) {
    return {
      fenAfter: fen,
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
    gameOver: false,
    winner: "",
    collision,
    captures,
    whiteApplied,
    blackApplied,
  };
}

export function padMoves(moves: PlannedMoveInput[]): PlannedMoveInput[] {
  const out = moves.slice(0, 5);
  while (out.length < 5) out.push({ ...EMPTY });
  return out;
}
