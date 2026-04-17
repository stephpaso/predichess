/** Messaggio `round_resolved` dal server (JSON, non Schema). */
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
