/** Messaggio `round_resolved` dal server (JSON, non Schema). */
export type RoundResolvedPayload = {
  roundIndex: number;
  fenBefore: string;
  whiteTokensAfter?: number;
  blackTokensAfter?: number;
  whiteBidSlot?: number;
  whiteBidAmount?: number;
  blackBidSlot?: number;
  blackBidAmount?: number;
  steps: Array<{
    whiteMove: string;
    blackMove: string;
    whiteApplied: boolean;
    blackApplied: boolean;
    fenAfterWhite: string;
    fenAfterFirst?: string;
    fenAfter: string;
    firstMover?: string;
    whiteBidAmount?: number;
    blackBidAmount?: number;
  }>;
};
