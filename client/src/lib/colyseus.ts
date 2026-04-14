import { Client } from "colyseus.js";
import type { Room } from "colyseus.js";
import { MatchMakeError } from "colyseus.js";
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

/**
 * Each call starts a new join. Do not dedupe by roomId: React 18 Strict Mode
 * mounts, unmounts, and remounts effects in dev; sharing one Promise made the
 * first cleanup call leave() on the Room the second mount was still using
 * ("locked" / broken sync on first load).
 */
export function joinPredictRoom(roomId: string): Promise<Room<PredictChessState>> {
  return getColyseusClient().joinById<PredictChessState>(roomId);
}

export async function createMatchRoom(): Promise<{ roomId: string; roomCode: string }> {
  const res = await fetch(`${apiBase}/match/create`, { method: "POST" });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<{ roomId: string; roomCode: string }>;
}

export function formatJoinError(err: unknown): string {
  if (err instanceof MatchMakeError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("locked")) {
      return "Questa stanza è piena o la partita è già iniziata. Crea una nuova stanza o rientra con un secondo dispositivo/giocatore.";
    }
    if (msg.includes("not found")) {
      return "Stanza non trovata o scaduta. Controlla il codice o crea una nuova stanza.";
    }
  }
  return "Connessione fallita. Controlla che il backend sia in esecuzione (porta 2567) e che il browser usi lo stesso host del server.";
}
