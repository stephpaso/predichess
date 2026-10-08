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

function tryFork(fen: string, color: Color): Chess | null {
  try {
    return forkForSide(fen, color);
  } catch {
    return null;
  }
}

function isOwnKingAt(c: Chess, square: Square, color: Color): boolean {
  const target = c.get(square);
  return !!target && target.type === "k" && target.color === color;
}

function isEnemyKingAt(c: Chess, square: Square, color: Color): boolean {
  const target = c.get(square);
  return !!target && target.type === "k" && target.color !== color;
}

function attacks(c: Chess, from: Square, to: Square, color: Color): boolean {
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
  try {
    const toN = normalizeCastleTarget(fen, from, to, color);
    const c = forkForSide(fen, color);
    const piece = c.get(from);
    if (!piece || piece.color !== color) return false;
    if (isOwnKingAt(c, toN, color)) return false;
    const moves = c.moves({ square: from, verbose: true });
    if (moves.some((m) => m.to === toN)) return true;
    const target = c.get(toN);
    if (target && target.color === color && target.type !== "k") {
      c.remove(toN);
      const moves2 = c.moves({ square: from, verbose: true });
      return moves2.some((m) => m.to === toN);
    }
    if (isEnemyKingAt(c, toN, color) && attacks(c, from, toN, color)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isInCheckForSide(fen: string, color: Color): boolean {
  const c = tryFork(fen, color);
  if (!c) return false;
  try {
    return c.isCheck();
  } catch {
    return false;
  }
}

/** Square of `color`'s king in `fen` (piece placement only; ignores side to move). */
export function getKingSquareOf(fen: string, color: Color): Square | null {
  const piece = color === "w" ? "K" : "k";
  const board = fen.trim().split(/\s+/)[0] ?? "";
  const ranks = board.split("/");
  for (let r = 0; r < ranks.length; r++) {
    let file = 0;
    for (const ch of ranks[r] ?? "") {
      if (ch >= "1" && ch <= "8") file += ch.charCodeAt(0) - 48;
      else {
        if (ch === piece && file < 8) return `${"abcdefgh"[file]}${8 - r}` as Square;
        file++;
      }
    }
  }
  return null;
}

/** Legal destination squares for planning (includes anticipated capture of own piece). */
export function getLegalTargetsForPlanning(
  fen: string,
  from: Square,
  color: Color
): Square[] {
  const c = tryFork(fen, color);
  if (!c) return [];
  const piece = c.get(from);
  if (!piece || piece.color !== color) return [];
  const out = new Set<Square>();
  const primary = c.moves({ square: from, verbose: true });
  for (const m of primary) {
    out.add(m.to as Square);
  }
  for (const sq of ALL_SQUARES) {
    const occ = c.get(sq);
    if (!occ || occ.color !== color || occ.type === "k") continue;
    if (primary.some((m) => m.to === sq)) continue;
    const trial = tryFork(fen, color);
    if (!trial) continue;
    trial.remove(sq as Square);
    const again = trial.moves({ square: from, verbose: true });
    if (again.some((m) => m.to === (sq as Square))) out.add(sq as Square);
  }
  for (const sq of ALL_SQUARES) {
    const occ = c.get(sq);
    if (occ && occ.type === "k" && occ.color !== color && attacks(c, from, sq, color)) {
      out.add(sq);
    }
  }
  return [...out];
}

export function findVerboseMoveTo(
  fen: string,
  from: Square,
  to: Square,
  color: Color
) {
  try {
    const toN = normalizeCastleTarget(fen, from, to, color);
    const c = forkForSide(fen, color);
    const piece = c.get(from);
    if (!piece || piece.color !== color) return null;
    if (isOwnKingAt(c, toN, color)) return null;
    let found = c.moves({ square: from, verbose: true }).find((m) => m.to === toN);
    if (!found) {
      const target = c.get(toN);
      if (target && target.color === color && target.type !== "k") {
        c.remove(toN);
        found = c.moves({ square: from, verbose: true }).find((m) => m.to === toN);
      }
    }
    if (!found && isEnemyKingAt(c, toN, color) && attacks(c, from, toN, color)) {
      return { to: toN, promotion: undefined, san: "" };
    }
    return found ? { to: toN, promotion: found.promotion, san: found.san } : null;
  } catch {
    return null;
  }
}

/** Applica una mossa di pianificazione sul FEN (rimuove il pezzo amico sul `to` se serve), come sul server. */
export function applyPlanningMove(
  fen: string,
  from: Square,
  to: Square,
  color: Color
): string | null {
  try {
    const toN = normalizeCastleTarget(fen, from, to, color);
    const c = forkForSide(fen, color);
    const piece = c.get(from);
    if (!piece || piece.color !== color) return null;
    if (isOwnKingAt(c, toN, color)) return null;
    const moves = c.moves({ square: from, verbose: true });
    let found = moves.find((m) => m.to === toN);
    if (!found) {
      const target = c.get(toN);
      if (target && target.color === color && target.type !== "k") {
        c.remove(toN);
        found = c.moves({ square: from, verbose: true }).find((m) => m.to === toN);
      }
    }
    if (!found) {
      if (isEnemyKingAt(c, toN, color) && attacks(c, from, toN, color)) {
        c.remove(from);
        c.remove(toN);
        c.put({ type: piece.type, color: piece.color }, toN);
        try {
          return c.fen();
        } catch {
          return null;
        }
      }
      return null;
    }
    const result = c.move({ from, to: toN, promotion: found.promotion });
    if (!result) return null;
    return c.fen();
  } catch {
    return null;
  }
}
