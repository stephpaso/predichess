import type { Color, Square } from "chess.js";

/** Piece placement only — never calls Chess.load (missing kings throw). */
export function countKings(fen: string): { w: number; b: number } {
  const board = String(fen ?? "").trim().split(/\s+/)[0] ?? "";
  let w = 0;
  let b = 0;
  for (const ch of board) {
    if (ch === "K") w++;
    else if (ch === "k") b++;
  }
  return { w, b };
}

/**
 * Winner from a kingless (or still intact) placement.
 * `null` = both kings still on the board.
 * Both missing → the side with priority (`priority`) wins; without one, draw.
 */
export function kingCaptureWinner(
  fen: string,
  priority: "w" | "b" = "w"
): "white" | "black" | "draw" | null {
  const { w, b } = countKings(fen);
  if (w > 0 && b > 0) return null;
  if (w === 0 && b === 0) return priority === "b" ? "black" : "white";
  if (b === 0) return "white";
  return "black";
}

function boardToGrid(board: string): string[][] {
  const ranks = board.split("/");
  return ranks.map((rank) => {
    const row: string[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        const n = ch.charCodeAt(0) - 48;
        for (let i = 0; i < n; i++) row.push("");
      } else if (ch !== "/") {
        row.push(ch);
      }
    }
    while (row.length < 8) row.push("");
    return row.slice(0, 8);
  });
}

function gridToBoard(grid: string[][]): string {
  return grid
    .map((row) => {
      let out = "";
      let empty = 0;
      for (const cell of row) {
        if (!cell) empty++;
        else {
          if (empty) {
            out += String(empty);
            empty = 0;
          }
          out += cell;
        }
      }
      if (empty) out += String(empty);
      return out || "8";
    })
    .join("/");
}

function sqToCoord(sq: Square): { r: number; f: number } | null {
  if (!/^[a-h][1-8]$/.test(sq)) return null;
  return { f: sq.charCodeAt(0) - 97, r: 8 - Number(sq[1]) };
}

/**
 * Move a piece on the FEN board without Chess.load.
 * Used when the destination is the enemy king: chess.js can apply the capture
 * but the resulting FEN cannot be loaded again.
 */
export function fenAfterManualMove(
  fen: string,
  from: Square,
  to: Square,
  color: Color,
  promotion?: string
): string | null {
  const parts = String(fen ?? "").trim().split(/\s+/);
  if (!parts[0] || !parts[0].includes("/")) return null;
  const grid = boardToGrid(parts[0]);
  if (grid.length < 8) return null;
  const a = sqToCoord(from);
  const b = sqToCoord(to);
  if (!a || !b) return null;
  const rowFrom = grid[a.r];
  const rowTo = grid[b.r];
  if (!rowFrom || !rowTo) return null;
  let piece = rowFrom[a.f] ?? "";
  if (!piece) return null;
  rowFrom[a.f] = "";
  if (promotion && piece.toLowerCase() === "p") {
    const p = promotion.toLowerCase();
    if ("qrbn".includes(p)) piece = color === "w" ? p.toUpperCase() : p;
  }
  rowTo[b.f] = piece;
  parts[0] = gridToBoard(grid);
  parts[1] = color === "w" ? "b" : "w";
  if (parts.length < 3) parts[2] = "-";
  if (parts.length < 4) parts[3] = "-";
  else parts[3] = "-";
  if (parts.length < 5) parts[4] = "0";
  if (parts.length < 6) parts[5] = "1";
  return parts.join(" ");
}
