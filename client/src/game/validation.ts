import { Chess, type Square, type Color } from "chess.js";

const ALL_SQUARES: Square[] = (() => {
  const out: Square[] = [];
  for (let r = 1; r <= 8; r++) {
    for (const f of "abcdefgh") {
      out.push(`${f}${r}` as Square);
    }
  }
  return out;
})();

export function withFenTurn(fen: string, color: Color): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return fen;
  if (parts[1] === color) return fen;
  parts[1] = color;
  // En-passant is only valid for the original side to move; flipping turn leaves a
  // FEN chess.js rejects ("illegal en-passant square").
  if (parts.length > 3) parts[3] = "-";
  return parts.join(" ");
}

export function forkForSide(fen: string, color: Color): Chess {
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
    if (color === "w" && to === "h1" && m.flags.includes("k")) return m.to as Square;
    if (color === "w" && to === "a1" && m.flags.includes("q")) return m.to as Square;
    if (color === "b" && to === "h8" && m.flags.includes("k")) return m.to as Square;
    if (color === "b" && to === "a8" && m.flags.includes("q")) return m.to as Square;
  }
  return (castles[0]?.to as Square) ?? to;
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

export function isInCheckForSide(fen: string, color: Color): boolean {
  const c = forkForSide(fen, color);
  return c.isCheck();
}

/** Legal destination squares for planning (includes anticipated capture of own piece). */
export function getLegalTargetsForPlanning(
  fen: string,
  from: Square,
  color: Color
): Square[] {
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return [];
  const out = new Set<Square>();
  const primary = c.moves({ square: from, verbose: true });
  for (const m of primary) {
    out.add(m.to as Square);
  }
  for (const sq of ALL_SQUARES) {
    const occ = c.get(sq);
    if (!occ || occ.color !== color) continue;
    if (primary.some((m) => m.to === sq)) continue;
    const trial = forkForSide(fen, color);
    trial.remove(sq as Square);
    const again = trial.moves({ square: from, verbose: true });
    if (again.some((m) => m.to === (sq as Square))) out.add(sq as Square);
  }
  return [...out];
}

export function findVerboseMoveTo(
  fen: string,
  from: Square,
  to: Square,
  color: Color
) {
  const toN = normalizeCastleTarget(fen, from, to, color);
  const c = forkForSide(fen, color);
  const piece = c.get(from);
  if (!piece || piece.color !== color) return null;
  let found = c.moves({ square: from, verbose: true }).find((m) => m.to === toN);
  if (!found) {
    const target = c.get(toN);
    if (target && target.color === color) {
      c.remove(toN);
      found = c.moves({ square: from, verbose: true }).find((m) => m.to === toN);
    }
  }
  return found ? { to: toN, promotion: found.promotion, san: found.san } : null;
}
