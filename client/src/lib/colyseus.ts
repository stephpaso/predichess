import { Client } from "colyseus.js";
import { PredictChessState } from "../schema/PredictChessState";

/** HTTP API: same origin in dev (Vite proxy → server). */
export const apiBase = import.meta.env.VITE_API_URL ?? "";

/**
 * Colyseus WebSocket URL. Must reach the same machine that runs the game server.
 * - Never hard-code 127.0.0.1: use the browser hostname so LAN / "localhost" work.
 * - On localhost, prefer 127.0.0.1 to avoid IPv6 (::1) vs IPv4 listen mismatches on Windows.
 */
export function getColyseusEndpoint(): string {
  const fromEnv = import.meta.env.VITE_COLYSEUS_URL;
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined" || !window.location?.hostname) {
    return "http://127.0.0.1:2567";
  }

  const { protocol, hostname } = window.location;
  const host =
    hostname === "localhost" || hostname === "127.0.0.1" ? "127.0.0.1" : hostname;

  return `${protocol}//${host}:2567`;
}

let client: Client | null = null;

export function getColyseusClient(): Client {
  if (!client) {
    client = new Client(getColyseusEndpoint());
  }
  return client;
}

export async function createMatchRoom(): Promise<{ roomId: string; roomCode: string }> {
  const res = await fetch(`${apiBase}/match/create`, { method: "POST" });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<{ roomId: string; roomCode: string }>;
}

export async function joinPredictRoom(roomId: string) {
  return getColyseusClient().joinById<PredictChessState>(roomId);
}
