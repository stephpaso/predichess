import { Chess } from "chess.js";
import { chooseInitiativeBid, HeuristicEngine } from "./HeuristicEngine.js";

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

const kingFen = "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1";
const cap = chooseInitiativeBid(kingFen, ["e2e3", "e3e8"], 3);
if (!cap || cap.slot !== 1 || cap.amount !== 1) {
  throw new Error(`expected bid 1 on the capture slot, got ${JSON.stringify(cap)}`);
}
const atCap = chooseInitiativeBid(kingFen, ["e2e8"], 4);
if (!atCap || atCap.slot !== 0 || atCap.amount !== 2) {
  throw new Error(`expected cap bid of 2, got ${JSON.stringify(atCap)}`);
}
const quiet = chooseInitiativeBid(new Chess().fen(), ["e2e4", "d2d4"], 3);
if (quiet !== null) throw new Error(`expected no bid on quiet moves, got ${JSON.stringify(quiet)}`);
const escape = chooseInitiativeBid("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1", ["e8d8"], 3);
if (!escape || escape.slot !== 0 || escape.amount !== 1) {
  throw new Error(`expected escape bid, got ${JSON.stringify(escape)}`);
}
if (chooseInitiativeBid(kingFen, ["e2e8"], 0) !== null) {
  throw new Error("zero tokens must not bid");
}

console.log("[HeuristicEngine] OK");

