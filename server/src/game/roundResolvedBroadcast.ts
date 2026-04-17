import type { RoundSnapshot } from "../schema/PredictChessState.js";

/** Payload JSON inviato con `broadcast("round_resolved", …)` — non dipende dalla replica Schema annidata lato client. */
export type RoundResolvedPayload = {
  roundIndex: number;
  fenBefore: string;
  steps: Array<{
    whiteMove: string;
    blackMove: string;
    whiteApplied: boolean;
    blackApplied: boolean;
    fenAfterWhite: string;
    fenAfter: string;
  }>;
};

export function serializeRoundResolvedPayload(round: RoundSnapshot): RoundResolvedPayload {
  const steps: RoundResolvedPayload["steps"] = [];
  for (let i = 0; i < round.steps.length; i++) {
    const s = round.steps.at(i);
    if (!s) continue;
    steps.push({
      whiteMove: s.whiteMove,
      blackMove: s.blackMove,
      whiteApplied: s.whiteApplied,
      blackApplied: s.blackApplied,
      fenAfterWhite: s.fenAfterWhite,
      fenAfter: s.fenAfter,
    });
  }
  return {
    roundIndex: round.roundIndex,
    fenBefore: round.fenBefore,
    steps,
  };
}
