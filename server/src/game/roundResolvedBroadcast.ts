import type { RoundSnapshot } from "../schema/PredictChessState.js";

/** Payload JSON inviato con `broadcast("round_resolved", …)` — non dipende dalla replica Schema annidata lato client. */
export type RoundResolvedPayload = {
  roundIndex: number;
  fenBefore: string;
  whiteTokensAfter: number;
  blackTokensAfter: number;
  whiteBidSlot: number;
  whiteBidAmount: number;
  blackBidSlot: number;
  blackBidAmount: number;
  steps: Array<{
    whiteMove: string;
    blackMove: string;
    whiteApplied: boolean;
    blackApplied: boolean;
    fenAfterWhite: string;
    fenAfterFirst: string;
    fenAfter: string;
    firstMover: string;
    whiteBidAmount: number;
    blackBidAmount: number;
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
      fenAfterFirst: s.fenAfterFirst,
      fenAfter: s.fenAfter,
      firstMover: s.firstMover,
      whiteBidAmount: s.whiteBidAmount,
      blackBidAmount: s.blackBidAmount,
    });
  }
  return {
    roundIndex: round.roundIndex,
    fenBefore: round.fenBefore,
    whiteTokensAfter: round.whiteTokensAfter,
    blackTokensAfter: round.blackTokensAfter,
    whiteBidSlot: round.whiteBidSlot,
    whiteBidAmount: round.whiteBidAmount,
    blackBidSlot: round.blackBidSlot,
    blackBidAmount: round.blackBidAmount,
    steps,
  };
}
