import { Chess, type Move } from "chess.js";
import type { IBotEngine, BotMoveUci } from "./IBotEngine.js";

type Rng = () => number;

const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function blunderChanceForElo(eloRaw: number): number {
  const elo = Math.max(100, Math.min(3000, Math.floor(Number(eloRaw) || 0)));
  // Piecewise interpolation anchored to the requested examples.
  // 400 -> 60%, 1800 -> 10%, 2500 -> 0%
  if (elo <= 400) return 0.6;
  if (elo <= 1000) return lerp(0.6, 0.3, clamp01((elo - 400) / 600));
  if (elo <= 1800) return lerp(0.3, 0.1, clamp01((elo - 1000) / 800));
  if (elo <= 2500) return lerp(0.1, 0.0, clamp01((elo - 1800) / 700));
  return 0.0;
}

function setFenTurn(fen: string, turn: "w" | "b"): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return fen;
  parts[1] = turn;
  return parts.join(" ");
}

function uciFromMove(m: Move): BotMoveUci {
  // chess.js verbose Move includes from/to and optional promotion piece.
  const promo = (m.promotion ?? "") as string;
  return `${m.from}${m.to}${promo || ""}`;
}

function parseUci(uci: string): { from: string; to: string; promotion?: string } | null {
  const s = String(uci ?? "").trim();
  if (s.length < 4) return null;
  const from = s.slice(0, 2);
  const to = s.slice(2, 4);
  const promotion = s.length >= 5 ? s.slice(4, 5) : undefined;
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return null;
  if (promotion && !/^[qrbn]$/.test(promotion)) return { from, to };
  return { from, to, promotion };
}

function opponentDefendsSquareAfterMove(chessAfter: Chess, square: string): boolean {
  // After our move, it's opponent's turn. If opponent has any legal move landing on `square`,
  // that means the square is "defended" in the practical sense (can recapture).
  const oppMoves = chessAfter.moves({ verbose: true }) as Move[];
  return oppMoves.some((m) => m.to === square);
}

function squareBonus(to: string): number {
  // Light, human-like preferences so "best move" isn't arbitrary on quiet positions.
  // Central control is the main signal.
  const core = new Set(["d4", "e4", "d5", "e5"]);
  if (core.has(to)) return 24;
  const extended = new Set(["c3", "c4", "c5", "c6", "f3", "f4", "f5", "f6"]);
  if (extended.has(to)) return 12;
  return 0;
}

function scoreMove(
  base: Chess,
  move: Move,
  elo: number
): number {
  let score = 0;

  score += squareBonus(move.to);

  // Encourage early development slightly (mostly affects quiet openings).
  if ((move.piece === "n" || move.piece === "b") && (move.from.endsWith("1") || move.from.endsWith("8"))) {
    score += 10;
  }

  const capturedValue = move.captured ? (PIECE_VALUE[move.captured] ?? 0) : 0;
  if (capturedValue > 0) score += capturedValue * 100;

  const movedValue = PIECE_VALUE[move.piece] ?? 0;

  const applied = base.move({ from: move.from, to: move.to, promotion: move.promotion });
  if (!applied) return -Infinity;

  if (base.isCheckmate()) {
    base.undo();
    return 10_000;
  }
  if (base.isCheck()) score += 50;

  if (elo > 1800 && capturedValue > 0) {
    const dest = move.to;
    const defended = opponentDefendsSquareAfterMove(base, dest);
    if (defended && capturedValue < movedValue) {
      score -= 120 + (movedValue - capturedValue) * 120;
    }
  }

  base.undo();
  return score;
}

export class HeuristicEngine implements IBotEngine {
  private rng: Rng;

  constructor(opts: { rng?: Rng } = {}) {
    this.rng = opts.rng ?? Math.random;
  }

  predictSequence(currentFen: string, numberOfMoves: number, elo: number): BotMoveUci[] {
    const n = Math.max(1, Math.min(10, Math.floor(Number(numberOfMoves) || 0)));
    const out: BotMoveUci[] = [];

    const chess = new Chess();
    chess.load(currentFen);
    const sideToMove = chess.turn(); // "w" | "b"

    for (let i = 0; i < n; i++) {
      chess.load(setFenTurn(chess.fen(), sideToMove));

      const legal = chess.moves({ verbose: true }) as Move[];
      if (!legal.length) break;

      const blunderChance = blunderChanceForElo(elo);
      const doBlunder = this.rng() < blunderChance;

      let chosen: Move;
      if (doBlunder) {
        chosen = legal[Math.floor(this.rng() * legal.length)];
      } else {
        let best = legal[0];
        let bestScore = -Infinity;
        for (const mv of legal) {
          const s = scoreMove(chess, mv, elo);
          if (s > bestScore) {
            bestScore = s;
            best = mv;
          }
        }
        chosen = best;
      }

      const applied = chess.move({ from: chosen.from, to: chosen.to, promotion: chosen.promotion });
      if (!applied) break;

      out.push(uciFromMove(chosen));

      // Force same side to move again for the next predicted ply (opponent "passes").
      const fenAfter = chess.fen();
      chess.load(setFenTurn(fenAfter, sideToMove));
    }

    return out;
  }

  // Exposed for BotRoom parsing convenience in a single place.
  static parseUci = parseUci;
}

