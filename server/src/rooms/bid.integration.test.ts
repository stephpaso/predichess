import { createServer } from "http";
import type { AddressInfo } from "net";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "@colyseus/sdk";
import { GameRoom } from "./GameRoom.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function waitFor(pred: () => boolean, ms = 4000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function run() {
  const httpServer = createServer();
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("predict_chess", GameRoom);
  await gameServer.listen(0);
  const port = (httpServer.address() as AddressInfo).port;
  const sdk = new Client(`http://127.0.0.1:${port}`);
  let white: Awaited<ReturnType<Client["joinById"]>> | null = null;
  let black: Awaited<ReturnType<Client["joinById"]>> | null = null;
  try {

  white = await sdk.create("predict_chess", {
    roomCode: "BID01",
    hostColorPref: "white",
    turnTimeSec: 60,
    predictiveSlots: 2,
    isPublic: false,
  });
  const blackMessages: Array<{ type: string | number; payload: unknown }> = [];
  black = await sdk.joinById(white.roomId, {});
  black.onMessage("*", (type, payload) => {
    blackMessages.push({ type, payload });
  });

  const serverRoom = matchMaker.getLocalRoomById(white.roomId) as GameRoom;
  await waitFor(() => serverRoom.state.phase === "planning");
  assert(serverRoom.state.whiteTokens === 3 && serverRoom.state.blackTokens === 3, "start tokens 3");

  const before = blackMessages.length;
  white.send("set_bid", { slot: 0, amount: 2 });
  await new Promise((r) => setTimeout(r, 150));
  const leaked = blackMessages.slice(before).some((m) => {
    const blob = JSON.stringify(m.payload ?? "");
    return blob.includes('"amount":2') || blob.includes('"slot":0');
  });
  assert(!leaked, "opponent received the bid before resolution");
  assert((serverRoom as unknown as { whiteBid: { amount: number } | null }).whiteBid?.amount === 2, "server stored bid");
  assert(serverRoom.state.whiteTokens === 3, "bid does not spend before resolve");

  white.send("set_bid", { slot: 0, amount: -1 });
  white.send("set_bid", { slot: 9, amount: 1 });
  white.send("set_bid", { slot: 0, amount: Number.NaN });
  white.send("set_bid", { slot: "0", amount: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert((serverRoom as unknown as { whiteBid: { amount: number } | null }).whiteBid?.amount === 2, "invalid bids ignored");
  white.send("set_bid", { whiteTokens: 99, blackTokens: 99, slot: 0, amount: 1 });
  await new Promise((r) => setTimeout(r, 80));
  assert(serverRoom.state.whiteTokens === 3 && serverRoom.state.blackTokens === 3, "client cannot set balances");
  assert((serverRoom as unknown as { whiteBid: { amount: number } | null }).whiteBid?.amount === 1, "only slot and amount are read");

  black.send("set_bid", { slot: 1, amount: 1, whiteTokens: 0 });
  await new Promise((r) => setTimeout(r, 80));
  assert((serverRoom as unknown as { whiteBid: { amount: number } | null }).whiteBid?.amount === 1, "black cannot overwrite white bid");
  assert(serverRoom.state.whiteTokens === 3, "black cannot zero white tokens");

  serverRoom.state.fen = "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1";
  white.send("submit_plan", {
    moves: [
      { from: "e2", to: "e8" },
      { from: "", to: "" },
    ],
    bid: { slot: 0, amount: 2 },
  });
  black.send("submit_plan", {
    moves: [
      { from: "", to: "" },
      { from: "", to: "" },
    ],
    bid: null,
  });

  await waitFor(() => serverRoom.state.phase === "finished");
  assert(serverRoom.state.winner === "white", `king capture winner, got ${serverRoom.state.winner}`);
  assert(serverRoom.state.whiteTokens === 1, "spent 2 of 3");
  const step = serverRoom.state.lastResolutionSteps.at(0);
  assert(step?.firstMover === "white", "revealed first mover");
  assert(step?.whiteBidAmount === 2, "revealed white bid");
  const revealed = blackMessages.some((m) => m.type === "round_resolved");
  assert(revealed, "round_resolved broadcast after resolution");

  console.log("[bid.integration] OK");
  } finally {
    try {
      await white?.leave();
    } catch {
      /* already gone */
    }
    try {
      await black?.leave();
    } catch {
      /* already gone */
    }
    await gameServer.gracefullyShutdown();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
