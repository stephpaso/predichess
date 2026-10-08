import { Chess } from "chess.js";
import {
  EMPTY_PLAN_ROUNDS_TO_DQ,
  advanceEmptyPlanStreaks,
  disqualificationWinner,
  type EmptyPlanStreaks,
} from "./emptyPlans.js";
import {
  PLAN_TIME_SEC_DEFAULT,
  PREDICTIVE_SLOTS_DEFAULT,
  clampPredictiveSlots,
  clampTurnTimeSec,
} from "./matchOptions.js";
import { resolvePlannedRound } from "./roundResolution.js";

function expectPieceAt(fen: string, square: string, piece: string | null) {
  const c = new Chess();
  c.load(fen);
  const p = c.get(square as never);
  const got = p ? `${p.color}${p.type}` : null;
  if (got !== piece) {
    throw new Error(`Expected ${piece ?? "empty"} at ${square}, got ${got ?? "empty"}\nfen=${fen}`);
  }
}

function run() {
  const startFen = new Chess().fen();

  // One filled slot plays; empty slots are passes and do not cancel the chosen moves.
  {
    const resolved = resolvePlannedRound({
      fen: startFen,
      roundIndex: 0,
      slots: 3,
      whiteMoves: [
        { from: "a2", to: "a3" },
        { from: "", to: "" },
        { from: "", to: "" },
      ],
      blackMoves: [
        { from: "", to: "" },
        { from: "", to: "" },
        { from: "a7", to: "a6" },
      ],
      whiteBid: null,
      blackBid: null,
      whiteTokens: 3,
      blackTokens: 3,
    });
    if (resolved.steps.length !== 3) throw new Error("Partial plan must still resolve every slot");
    if (!resolved.steps[0]?.whiteApplied || resolved.steps[0]?.blackApplied) {
      throw new Error("Only the filled white slot should apply on step 0");
    }
    if (resolved.steps[1]?.whiteApplied || resolved.steps[1]?.blackApplied) {
      throw new Error("Empty step must pass for both sides");
    }
    if (resolved.steps[2]?.whiteApplied || !resolved.steps[2]?.blackApplied) {
      throw new Error("A later filled slot must still apply after empty slots");
    }
    expectPieceAt(resolved.fen, "a3", "wp");
    expectPieceAt(resolved.fen, "a2", null);
    expectPieceAt(resolved.fen, "a6", "bp");
    expectPieceAt(resolved.fen, "a7", null);
  }

  // An illegal slot is skipped. A later legal move by the same piece still plays.
  {
    const resolved = resolvePlannedRound({
      fen: startFen,
      roundIndex: 0,
      slots: 2,
      whiteMoves: [
        { from: "e2", to: "e5" },
        { from: "e2", to: "e4" },
      ],
      blackMoves: [
        { from: "", to: "" },
        { from: "c7", to: "c6" },
      ],
      whiteBid: null,
      blackBid: null,
      whiteTokens: 3,
      blackTokens: 3,
    });
    if (resolved.steps[0]?.whiteApplied) throw new Error("Illegal e2e5 must not apply");
    if (!resolved.steps[1]?.whiteApplied) throw new Error("Later e2e4 must still apply");
    if (!resolved.steps[1]?.blackApplied) throw new Error("Black's later move must still apply");
    expectPieceAt(resolved.fen, "e4", "wp");
    expectPieceAt(resolved.fen, "e2", null);
    expectPieceAt(resolved.fen, "c6", "bp");
  }

  {
    let streaks: EmptyPlanStreaks = { white: 0, black: 0 };
    streaks = advanceEmptyPlanStreaks(streaks, false, true);
    if (disqualificationWinner(streaks) !== null) {
      throw new Error("One empty round must not disqualify");
    }
    streaks = advanceEmptyPlanStreaks(streaks, false, true);
    if (disqualificationWinner(streaks) !== "black") {
      throw new Error("Two empty white rounds: black wins");
    }
    if (EMPTY_PLAN_ROUNDS_TO_DQ !== 2) throw new Error("DQ threshold must be 2");
  }

  {
    let streaks: EmptyPlanStreaks = { white: 0, black: 0 };
    streaks = advanceEmptyPlanStreaks(streaks, false, false);
    streaks = advanceEmptyPlanStreaks(streaks, false, false);
    if (disqualificationWinner(streaks) !== "draw") {
      throw new Error("Both empty for two rounds is a draw");
    }
  }

  {
    let streaks: EmptyPlanStreaks = { white: 1, black: 0 };
    streaks = advanceEmptyPlanStreaks(streaks, true, true);
    if (streaks.white !== 0 || disqualificationWinner(streaks) !== null) {
      throw new Error("A chosen move resets the empty streak");
    }
  }

  if (clampPredictiveSlots(1) !== 2) throw new Error("1 predictive slot must clamp to 2");
  if (clampPredictiveSlots(undefined) !== PREDICTIVE_SLOTS_DEFAULT) {
    throw new Error("Missing slots must default to 2");
  }
  if (clampPredictiveSlots(9) !== 5) throw new Error("Slots must cap at 5");
  if (PREDICTIVE_SLOTS_DEFAULT !== 2) throw new Error("Default slots must be 2");
  if (clampTurnTimeSec(undefined) !== PLAN_TIME_SEC_DEFAULT) {
    throw new Error("Missing turn time must default to 45");
  }
  if (PLAN_TIME_SEC_DEFAULT !== 45) throw new Error("Default planning time must be 45 seconds");
  if (clampTurnTimeSec(15) !== 15) throw new Error("Explicit 15s stays inside the slider range");

  console.log("[planningRules.test] OK");
}

run();
