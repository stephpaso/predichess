import { Chess } from "chess.js";
import { kingCaptureWinner, countKings } from "./kings.js";
import {
  isSideInCheck,
  loserForIgnoredCheckIfAny,
  padMoves,
  padMovesN,
  resolveOneStep,
  type PlannedMoveInput,
} from "./resolver.js";
import { resolvePlannedRound } from "./roundResolution.js";

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

  // King capture: missing king must not throw. White takes the black king.
  {
    const fen = "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1";
    const res = resolveOneStep(fen, { from: "e2", to: "e8" }, { from: "", to: "" }, "w");
    if (res.winner !== "white" || !res.gameOver) {
      throw new Error(`Expected white to win by king capture, got ${JSON.stringify(res)}`);
    }
    const kings = countKings(res.fenAfter);
    if (kings.b !== 0 || kings.w !== 1) {
      throw new Error(`Expected only the white king left, got ${JSON.stringify(kings)} fen=${res.fenAfter}`);
    }
    if (kingCaptureWinner(res.fenAfter, "w") !== "white") {
      throw new Error("kingCaptureWinner should report white without throwing");
    }
  }

  // Black has priority and captures the white king.
  {
    const fen = "4k3/4q3/8/8/8/8/8/4K3 w - - 0 1";
    const res = resolveOneStep(fen, { from: "", to: "" }, { from: "e7", to: "e1" }, "b");
    if (res.winner !== "black" || !res.gameOver) {
      throw new Error(`Expected black to win by king capture, got ${JSON.stringify(res)}`);
    }
    if (!res.blackApplied || res.whiteApplied) {
      throw new Error("Expected only black's capture to apply");
    }
  }

  // Both plans would capture a king in the same step: first mover wins, second move is not applied.
  {
    const fen = "3Qk3/8/8/8/8/8/8/3qK3 w - - 0 1";
    const white = { from: "d8", to: "e8" };
    const black = { from: "d1", to: "e1" };
    const asWhite = resolveOneStep(fen, white, black, "w");
    if (asWhite.winner !== "white" || !asWhite.gameOver) {
      throw new Error(`Both-kings step, white priority: ${JSON.stringify(asWhite)}`);
    }
    if (countKings(asWhite.fenAfter).w !== 1 || countKings(asWhite.fenAfter).b !== 0) {
      throw new Error(`White priority should remove only the black king: ${asWhite.fenAfter}`);
    }
    const asBlack = resolveOneStep(fen, white, black, "b");
    if (asBlack.winner !== "black" || !asBlack.gameOver) {
      throw new Error(`Both-kings step, black priority: ${JSON.stringify(asBlack)}`);
    }
    if (countKings(asBlack.fenAfter).b !== 1 || countKings(asBlack.fenAfter).w !== 0) {
      throw new Error(`Black priority should remove only the white king: ${asBlack.fenAfter}`);
    }
    if (kingCaptureWinner("8/8/8/8/8/8/8/8 w - - 0 1", "b") !== "black") {
      throw new Error("Both kings already gone: priority side wins, no throw");
    }
  }

  // Moving onto your own king is illegal and must not delete it.
  {
    const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
    const res = resolveOneStep(fen, { from: "a1", to: "e1" }, { from: "", to: "" }, "w");
    if (res.whiteApplied) throw new Error("Own-king destination must not apply");
    if (res.gameOver) throw new Error("Own-king destination must not end the game");
    expectPieceAt(res.fenAfter, "e1", "wk");
    expectPieceAt(res.fenAfter, "a1", "wr");
  }

  // firstMover changes who wins a mutual pawn capture.
  {
    const fen = "4k3/8/8/4p3/3P4/8/8/4K3 w - - 0 1";
    const white = { from: "d4", to: "e5" };
    const black = { from: "e5", to: "d4" };
    const wFirst = resolveOneStep(fen, white, black, "w");
    const bFirst = resolveOneStep(fen, white, black, "b");
    expectPieceAt(wFirst.fenAfter, "e5", "wp");
    expectPieceAt(wFirst.fenAfter, "d4", null);
    expectPieceAt(bFirst.fenAfter, "d4", "bp");
    expectPieceAt(bFirst.fenAfter, "e5", null);
    if (wFirst.fenAfter === bFirst.fenAfter) {
      throw new Error("White-first and black-first must diverge");
    }
  }

  // No bids: priority alternates. Equal bids: fewer tokens after spend. Solo bid spends once.
  {
    const fen = new Chess().fen();
    const quiet = resolvePlannedRound({
      fen,
      roundIndex: 0,
      slots: 2,
      whiteMoves: [
        { from: "a2", to: "a3" },
        { from: "b2", to: "b3" },
      ],
      blackMoves: [
        { from: "a7", to: "a6" },
        { from: "b7", to: "b6" },
      ],
      whiteBid: null,
      blackBid: null,
      whiteTokens: 3,
      blackTokens: 3,
    });
    if (quiet.steps[0]?.firstMover !== "white" || quiet.steps[1]?.firstMover !== "black") {
      throw new Error(`Expected alternating priority, got ${quiet.steps.map((s) => s.firstMover).join(",")}`);
    }
    if (quiet.whiteTokens !== 3 || quiet.blackTokens !== 3) {
      throw new Error("No bids must not spend tokens");
    }

    const round1 = resolvePlannedRound({
      fen,
      roundIndex: 1,
      slots: 1,
      whiteMoves: [{ from: "a2", to: "a3" }],
      blackMoves: [{ from: "a7", to: "a6" }],
      whiteBid: null,
      blackBid: null,
      whiteTokens: 4,
      blackTokens: 4,
    });
    if (round1.steps[0]?.firstMover !== "black") {
      throw new Error("Round 1 step 0 with no bids must be black first");
    }
    if (round1.whiteTokens !== 4) throw new Error("Cap must not grow on resolve");

    const tied = resolvePlannedRound({
      fen,
      roundIndex: 0,
      slots: 1,
      whiteMoves: [{ from: "d2", to: "d4" }],
      blackMoves: [{ from: "d7", to: "d5" }],
      whiteBid: { slot: 0, amount: 2 },
      blackBid: { slot: 0, amount: 2 },
      whiteTokens: 4,
      blackTokens: 2,
    });
    // After spend: white 2, black 0. Black has fewer → black first.
    if (tied.steps[0]?.firstMover !== "black") {
      throw new Error(`Equal bid should favor fewer remaining tokens, got ${tied.steps[0]?.firstMover}`);
    }
    if (tied.whiteTokens !== 2 || tied.blackTokens !== 0) {
      throw new Error(`Expected spend 4→2 and 2→0, got ${tied.whiteTokens}/${tied.blackTokens}`);
    }
    if (tied.steps[0]?.whiteBidAmount !== 2 || tied.steps[0]?.blackBidAmount !== 2) {
      throw new Error("Revealed bids missing");
    }

    const solo = resolvePlannedRound({
      fen,
      roundIndex: 0,
      slots: 2,
      whiteMoves: [
        { from: "a2", to: "a3" },
        { from: "b2", to: "b3" },
      ],
      blackMoves: [
        { from: "a7", to: "a6" },
        { from: "b7", to: "b6" },
      ],
      whiteBid: { slot: 1, amount: 1 },
      blackBid: null,
      whiteTokens: 3,
      blackTokens: 3,
    });
    if (solo.steps[0]?.firstMover !== "white") throw new Error("Uncontested step 0 stays alternating (white)");
    if (solo.steps[1]?.firstMover !== "white") throw new Error("Solo bid on step 1 must be white first");
    if (solo.whiteTokens !== 2) throw new Error("Solo bid must spend once");
    if (solo.steps[0]?.whiteBidAmount !== 0 || solo.steps[1]?.whiteBidAmount !== 1) {
      throw new Error("Bid amount should be revealed only on the contested slot");
    }
  }

  console.log("[resolver.test] OK");
}

run();

