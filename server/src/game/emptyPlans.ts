/** Consecutive planning rounds with no chosen move before that side is disqualified. */
export const EMPTY_PLAN_ROUNDS_TO_DQ = 2;

export type EmptyPlanStreaks = { white: number; black: number };

export function advanceEmptyPlanStreaks(
  prev: EmptyPlanStreaks,
  whiteHasMove: boolean,
  blackHasMove: boolean
): EmptyPlanStreaks {
  return {
    white: whiteHasMove ? 0 : prev.white + 1,
    black: blackHasMove ? 0 : prev.black + 1,
  };
}

/**
 * After the round is resolved. The side with no moves for two rounds loses.
 * Both sides at the threshold is a draw. One empty round is not enough.
 */
export function disqualificationWinner(
  streaks: EmptyPlanStreaks
): "white" | "black" | "draw" | null {
  const whiteOut = streaks.white >= EMPTY_PLAN_ROUNDS_TO_DQ;
  const blackOut = streaks.black >= EMPTY_PLAN_ROUNDS_TO_DQ;
  if (whiteOut && blackOut) return "draw";
  if (whiteOut) return "black";
  if (blackOut) return "white";
  return null;
}

export function emptyPlanDqMessage(winner: "white" | "black" | "draw"): string {
  return winner === "draw"
    ? "Patta: entrambi senza mosse per due turni."
    : "Squalifica: due turni di fila senza mosse.";
}
