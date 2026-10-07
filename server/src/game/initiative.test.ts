import { PredictChessState, StepSnapshot } from "../schema/PredictChessState.js";
import {
  parseBidPayload,
  tokensAtPlanningStart,
  TOKEN_CAP,
  TOKEN_START,
} from "./initiative.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  assert(tokensAtPlanningStart(null) === TOKEN_START, "first planning starts at 3");
  assert(tokensAtPlanningStart(3) === 4, "refresh 3 → 4");
  assert(tokensAtPlanningStart(4) === TOKEN_CAP, "cap stays 4");
  assert(tokensAtPlanningStart(0) === 1, "refresh from 0 is 1");
  assert(tokensAtPlanningStart(1) === 2, "refresh 1 → 2");

  const slots = 3;
  assert(parseBidPayload(null, slots, 3).ok, "null bid clears");
  assert(parseBidPayload({ clear: true }, slots, 3).ok, "clear");
  const ok = parseBidPayload({ slot: 1, amount: 2 }, slots, 3);
  assert(ok.ok && ok.bid?.slot === 1 && ok.bid.amount === 2, "valid bid");
  assert(!parseBidPayload({ slot: 1, amount: 4 }, slots, 3).ok, "amount above tokens");
  assert(!parseBidPayload({ slot: -1, amount: 1 }, slots, 3).ok, "negative slot");
  assert(!parseBidPayload({ slot: 3, amount: 1 }, slots, 3).ok, "slot out of range");
  assert(!parseBidPayload({ slot: 1.5, amount: 1 }, slots, 3).ok, "fractional slot");
  assert(!parseBidPayload({ slot: 1, amount: Number.NaN }, slots, 3).ok, "NaN");
  assert(!parseBidPayload({ slot: 1, amount: Number.POSITIVE_INFINITY }, slots, 3).ok, "infinity");
  assert(!parseBidPayload({ slot: 1, amount: -2 }, slots, 3).ok, "negative amount");
  assert(!parseBidPayload({ slot: "1", amount: 1 }, slots, 3).ok, "string slot");
  assert(!parseBidPayload({ slot: 0, amount: 1e21 }, slots, 3).ok, "huge amount");
  assert(!parseBidPayload({ bids: [{ slot: 0, amount: 1 }] }, slots, 3).ok, "multi bid rejected");
  const bulky: Record<string, number> = { slot: 0, amount: 1 };
  for (let i = 0; i < 12; i++) bulky["k" + i] = i;
  assert(!parseBidPayload(bulky, slots, 3).ok, "oversized bid payload");
  const zero = parseBidPayload({ slot: 0, amount: 0 }, slots, 3);
  assert(zero.ok && zero.bid === null, "zero amount is no bid");

  const state = new PredictChessState();
  const meta = (PredictChessState as unknown as { [Symbol.metadata]: Record<string, unknown> })[Symbol.metadata];
  const names = Object.values(meta)
    .filter((v) => v && typeof v === "object" && "name" in (v as object))
    .map((v) => String((v as { name: string }).name));
  assert(!names.includes("whiteBid"), "live white bid is not a synced field");
  assert(!names.includes("blackBid"), "live black bid is not a synced field");
  assert(names.includes("whiteTokens") && names.includes("blackTokens"), "balances are public schema");
  assert(state.whiteTokens === 3 && state.blackTokens === 3, "default balances");
  const stepMeta = (StepSnapshot as unknown as { [Symbol.metadata]: Record<string, unknown> })[Symbol.metadata];
  const stepNames = Object.values(stepMeta)
    .filter((v) => v && typeof v === "object" && "name" in (v as object))
    .map((v) => String((v as { name: string }).name));
  assert(stepNames.includes("firstMover"), "revealed priority lives on the step snapshot");
  assert(stepNames.includes("whiteBidAmount"), "revealed bid amount lives on the step snapshot");

  console.log("[initiative.test] OK");
}

run();
