import { Chess } from "chess.js";
import {
  isSideInCheck,
  loserForIgnoredCheckIfAny,
  padMoves,
  padMovesN,
  resolveOneStep,
  type PlannedMoveInput,
} from "./resolver.js";

function applySteps(fenBefore: string, white: PlannedMoveInput[], black: PlannedMoveInput[]) {
  let fen = fenBefore;
  const wm = padMoves(white);
  const bm = padMoves(black);
  for (let i = 0; i < 5; i++) {
    const res = resolveOneStep(fen, wm[i], bm[i]);
    fen = res.fenAfter;
  }
  return fen;
}

function expectPieceAt(fen: string, square: string, piece: string | null) {
  const c = new Chess();
  c.load(fen);
  const p = c.get(square as any);
  const got = p ? `${p.color}${p.type}` : null;
  if (got !== piece) {
    throw new Error(`Expected ${piece ?? "empty"} at ${square}, got ${got ?? "empty"}\nfen=${fen}`);
  }
}

function run() {
  const startFen = new Chess().fen();

  // padMovesN: respects custom slots and truncates.
  {
    const out = padMovesN(
      [
        { from: "a2", to: "a3" },
        { from: "b2", to: "b3" },
        { from: "c2", to: "c3" },
        { from: "d2", to: "d3" },
      ],
      3
    );
    if (out.length !== 3) throw new Error(`Expected 3 moves, got ${out.length}`);
    if (out[2]?.from !== "c2" || out[2]?.to !== "c3") {
      throw new Error(`Expected third move c2->c3, got ${JSON.stringify(out[2])}`);
    }
  }

  // Case 1: White then Black sequentially, both legal.
  {
    const fen = applySteps(
      startFen,
      [{ from: "e2", to: "e4" }],
      [{ from: "c7", to: "c5" }]
    );
    expectPieceAt(fen, "e4", "wp");
    expectPieceAt(fen, "c5", "bp");
  }

  // Case 2: White move makes Black's planned move illegal (source captured / moved).
  // White: d2->d4, then d4xc5 (captures pawn after black played c7->c5 in step 1).
  // Black: c7->c5, then c5->c4 (second move should fail because pawn got captured by white in step 2).
  {
    const fen = applySteps(
      startFen,
      [
        { from: "d2", to: "d4" },
        { from: "d4", to: "c5" },
      ],
      [
        { from: "c7", to: "c5" },
        { from: "c5", to: "c4" },
      ]
    );
    expectPieceAt(fen, "c5", "wp");
    expectPieceAt(fen, "c4", null);
  }

  // Case 3: "Collision" destination same square is naturally resolved by order (white first).
  // White e2->e4 and Black d7->e6 both are legal but do not collide; use a real conflict:
  // White: d2->d4, Black: e7->e5, then both try to capture on e5 (white d4xe5, black ... can't because pawn moved)
  // This asserts algorithm doesn't crash and yields deterministic result.
  {
    const fen = applySteps(
      startFen,
      [
        { from: "d2", to: "d4" },
        { from: "d4", to: "e5" },
      ],
      [
        { from: "e7", to: "e5" },
        { from: "e5", to: "d4" },
      ]
    );
    // After step2: white captures on e5 first; black's e5->d4 should fail because piece no longer at e5.
    expectPieceAt(fen, "e5", "wp");
  }

  // Case 4: In-check position must not throw when validating moves for either side.
  // This specifically guards against chess.js "Null move not allowed when in check" caused by turn alignment.
  {
    const fenInCheck = "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1"; // black to move, black king in check by white rook
    const res = resolveOneStep(fenInCheck, { from: "", to: "" }, { from: "", to: "" });
    if (!res || typeof res.fenAfter !== "string") throw new Error("Expected resolution result");
  }

  // Case 5: Planned "capture" of own piece — knight takes square occupied by own pawn.
  {
    const fenFriendly = "7k/8/8/8/8/2P5/8/1N2K3 w - - 0 1";
    const res = resolveOneStep(
      fenFriendly,
      { from: "b1", to: "c3" },
      { from: "", to: "" }
    );
    if (!res.whiteApplied) throw new Error("Expected white friendly-capture to apply");
    expectPieceAt(res.fenAfter, "c3", "wn");
    expectPieceAt(res.fenAfter, "b1", null);
    if (!res.fenAfterWhite || res.fenAfterWhite !== res.fenAfter) {
      throw new Error("Expected fenAfterWhite after lone white move");
    }
  }

  // Case 6: Anti-stall — side to move in check must address check in isolated plan (all pass => lose).
  {
    const fenBlackInCheck = "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1";
    const empty5 = (): PlannedMoveInput[] =>
      Array.from({ length: 5 }, () => ({ from: "", to: "" }));
    const lose = loserForIgnoredCheckIfAny(fenBlackInCheck, empty5(), empty5());
    if (lose !== "black") throw new Error(`Expected black to lose when ignoring check, got ${lose}`);
  }

  // Case 7: Anti-stall — legal move that escapes check => no loss.
  {
    const fenBlackInCheck = "4k3/8/8/8/8/8/4R3/4K3 b - - 0 1";
    const empty5 = (): PlannedMoveInput[] =>
      Array.from({ length: 5 }, () => ({ from: "", to: "" }));
    const bm: PlannedMoveInput[] = [
      { from: "e8", to: "d8" },
      ...Array.from({ length: 4 }, () => ({ from: "", to: "" })),
    ];
    const ok = loserForIgnoredCheckIfAny(fenBlackInCheck, empty5(), bm);
    if (ok !== null) throw new Error(`Expected no loser when escaping check, got ${ok}`);
  }

  // Case 8: Anti-stall — not in check at round start => rule inactive.
  {
    const fen = new Chess().fen();
    const empty5 = (): PlannedMoveInput[] =>
      Array.from({ length: 5 }, () => ({ from: "", to: "" }));
    const none = loserForIgnoredCheckIfAny(fen, empty5(), empty5());
    if (none !== null) throw new Error(`Expected no loser from start position, got ${none}`);
  }

  // Case 9: Anti-stall — white to move and in check, all pass => white loses.
  {
    const fenWhiteInCheck = "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1";
    const empty5 = (): PlannedMoveInput[] =>
      Array.from({ length: 5 }, () => ({ from: "", to: "" }));
    const lose = loserForIgnoredCheckIfAny(fenWhiteInCheck, empty5(), empty5());
    if (lose !== "white") throw new Error(`Expected white to lose when ignoring check, got ${lose}`);
  }

  // Case 10: After 1.e4, FEN has Black to move and an ep square; checking the other side's
  // king must not throw (withFenTurn must clear ep when flipping turn).
  {
    const c = new Chess();
    c.move("e4");
    const fenAfterE4 = c.fen();
    if (!fenAfterE4.includes(" b ")) throw new Error("Expected black to move after 1.e4");
    const ok = isSideInCheck(fenAfterE4, "w");
    if (typeof ok !== "boolean") throw new Error("Expected boolean from isSideInCheck");
  }

  console.log("[resolver.test] OK");
}

run();

