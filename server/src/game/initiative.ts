/** Public token economy and hidden per-round bids. Server is the source of truth. */

export const TOKEN_START = 3;
export const TOKEN_CAP = 4;
export const TOKEN_REFRESH = 1;

export type InitiativeBid = { slot: number; amount: number };

export type BidParseResult =
  | { ok: true; bid: InitiativeBid | null }
  | { ok: false; reason: "invalid" };

function clampTokens(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const t = Math.floor(n);
  if (t < 0) return 0;
  if (t > TOKEN_CAP) return TOKEN_CAP;
  return t;
}

/** First planning round starts at 3. Later rounds: +1, never above 4. */
export function tokensAtPlanningStart(previous: number | null): number {
  if (previous == null) return TOKEN_START;
  return Math.min(TOKEN_CAP, clampTokens(previous) + TOKEN_REFRESH);
}

/**
 * Accept a single bid object. Integers only.
 * `null` / `{clear:true}` / amount 0 → no bid.
 * Rejects NaN, non-integers, strings, negatives, out-of-range slot, amount > tokens.
 */
export function parseBidPayload(
  message: unknown,
  predictiveSlots: number,
  tokens: number
): BidParseResult {
  if (message == null) return { ok: true, bid: null };
  if (typeof message !== "object" || Array.isArray(message)) return { ok: false, reason: "invalid" };
  const msg = message as Record<string, unknown>;
  if (Object.keys(msg).length > 8) return { ok: false, reason: "invalid" };
  if (Array.isArray(msg.bids) || Array.isArray(msg.slots)) return { ok: false, reason: "invalid" };
  if (msg.clear === true) return { ok: true, bid: null };

  if (msg.slot === undefined && msg.amount === undefined) return { ok: true, bid: null };
  if (typeof msg.slot !== "number" || typeof msg.amount !== "number") {
    return { ok: false, reason: "invalid" };
  }
  if (!Number.isInteger(msg.slot) || !Number.isInteger(msg.amount)) {
    return { ok: false, reason: "invalid" };
  }

  const slots = Math.max(1, Math.min(5, Math.floor(Number(predictiveSlots) || 0) || 1));
  const purse = clampTokens(tokens);
  if (msg.amount === 0) return { ok: true, bid: null };
  if (msg.amount < 0 || msg.amount > purse || msg.amount > TOKEN_CAP) {
    return { ok: false, reason: "invalid" };
  }
  if (msg.slot < 0 || msg.slot >= slots) return { ok: false, reason: "invalid" };
  return { ok: true, bid: { slot: msg.slot, amount: msg.amount } };
}

/** White first iff (round + step) is even. Indexes are 0-based. */
export function defaultFirstMover(roundIndex: number, stepIndex: number): "w" | "b" {
  const r = Math.floor(Number(roundIndex) || 0);
  const i = Math.floor(Number(stepIndex) || 0);
  return (r + i) % 2 === 0 ? "w" : "b";
}

export function activeBid(bid: InitiativeBid | null | undefined, stepIndex: number): number {
  if (!bid || bid.amount <= 0 || bid.slot !== stepIndex) return 0;
  return bid.amount;
}

/**
 * Priority for one step. Balances are AFTER both bids have been spent.
 * Always returns a first mover.
 */
export function firstMoverForStep(
  roundIndex: number,
  stepIndex: number,
  whiteBid: InitiativeBid | null,
  blackBid: InitiativeBid | null,
  whiteTokensAfter: number,
  blackTokensAfter: number
): "w" | "b" {
  const w = activeBid(whiteBid, stepIndex);
  const b = activeBid(blackBid, stepIndex);
  const alt = defaultFirstMover(roundIndex, stepIndex);
  if (w > 0 && b <= 0) return "w";
  if (b > 0 && w <= 0) return "b";
  if (w > 0 && b > 0) {
    if (w > b) return "w";
    if (b > w) return "b";
    if (whiteTokensAfter < blackTokensAfter) return "w";
    if (blackTokensAfter < whiteTokensAfter) return "b";
    return alt;
  }
  return alt;
}

export function spendBidTokens(
  whiteTokens: number,
  blackTokens: number,
  whiteBid: InitiativeBid | null,
  blackBid: InitiativeBid | null
): { whiteTokens: number; blackTokens: number } {
  const wSpend = whiteBid && whiteBid.amount > 0 ? whiteBid.amount : 0;
  const bSpend = blackBid && blackBid.amount > 0 ? blackBid.amount : 0;
  return {
    whiteTokens: Math.max(0, clampTokens(whiteTokens) - wSpend),
    blackTokens: Math.max(0, clampTokens(blackTokens) - bSpend),
  };
}

/** Per-client message throttle for bid updates. Returns false when the caller should drop the message. */
export function allowBidRate(hits: number[], now: number, limit = 15, windowMs = 1000): { ok: boolean; hits: number[] } {
  const recent = hits.filter((t) => now - t < windowMs);
  if (recent.length >= limit) return { ok: false, hits: recent };
  recent.push(now);
  return { ok: true, hits: recent };
}
