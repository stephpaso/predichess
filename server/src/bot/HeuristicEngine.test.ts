import { Chess } from "chess.js";
import { HeuristicEngine } from "./HeuristicEngine.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sequenceRng(values: number[]) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0.5;
    i += 1;
    return v;
  };
}

function applyUciSequence(startFen: string, seq: string[]): string {
  const c = new Chess();
  c.load(startFen);
  const side = c.turn();
  for (const uci of seq) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length >= 5 ? (uci.slice(4, 5) as any) : undefined;
    c.load(c.fen().split(" ").map((p, i) => (i === 1 ? side : p)).join(" "));
    const ok = c.move({ from, to, promotion });
    if (!ok) throw new Error(`illegal move in sequence: ${uci}`);
    // force same side to move again (opponent "passes")
    const parts = c.fen().split(" ");
    parts[1] = side;
    c.load(parts.join(" "));
  }
  return c.fen();
}

const startFen = new Chess().fen();

const seq2500 = new HeuristicEngine({ rng: mulberry32(123) }).predictSequence(startFen, 3, 2500);
console.log("[HeuristicEngine] ELO 2500:", seq2500.join(" "));
applyUciSequence(startFen, seq2500);

const first2500 = seq2500[0] ?? "";
if (!(first2500.startsWith("e2e4") || first2500.startsWith("d2d4"))) {
  throw new Error(`expected elo2500 first move to be central pawn (e2e4/d2d4), got: ${first2500}`);
}

// Low ELO: force the blunder path deterministically.
// rng[0]=0.0 -> doBlunder always true (since blunderChance=0.6)
// rng[1]=0.999 -> pick near the end of the legal move list
const seq400 = new HeuristicEngine({ rng: sequenceRng([0.0, 0.999, 0.0, 0.999, 0.0, 0.999]) }).predictSequence(
  startFen,
  3,
  400
);
console.log("[HeuristicEngine] ELO 400 (forced blunders):", seq400.join(" "));
applyUciSequence(startFen, seq400);
const first400 = seq400[0] ?? "";
if (first400.startsWith("e2e4") || first400.startsWith("d2d4")) {
  throw new Error(`expected elo400 (forced blunder) first move to be suboptimal, got: ${first400}`);
}

console.log("[HeuristicEngine] OK");

