import { Chess, type Square, type Color } from "chess.js";

export function forkForSide(fen: string, color: Color): Chess {
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
