import { Client } from "colyseus.js";
import { PredictChessState } from "../schema/PredictChessState";

/** HTTP API base (use same origin + Vite proxy in dev). */
export const apiBase = import.meta.env.VITE_API_URL ?? "";

/** Colyseus WebSocket endpoint (must match server port in dev). */
export const colyseusEndpoint =
  import.meta.env.VITE_COLYSEUS_URL ?? "http://127.0.0.1:2567";

export const colyseus = new Client(colyseusEndpoint);

export async function createMatchRoom(): Promise<{ roomId: string; roomCode: string }> {
  const res = await fetch(`${apiBase}/match/create`, { method: "POST" });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<{ roomId: string; roomCode: string }>;
}

export async function joinPredictRoom(roomId: string) {
  return colyseus.joinById<PredictChessState>(roomId);
}
