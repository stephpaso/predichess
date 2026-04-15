import { Chess, type Square, type Color } from "chess.js";

function withFenTurn(fen: string, color: Color): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return fen;
  parts[1] = color;
  return parts.join(" ");
}

export function forkForSide(fen: string, color: Color): Chess {
  const c = new Chess();
  c.load(withFenTurn(fen, color));
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

export function isInCheckForSide(fen: string, color: Color): boolean {
  const c = forkForSide(fen, color);
  return c.isCheck();
}
