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

export type CreateRoomResponse = {
  roomId: string;
  roomCode: string;
  reservation: unknown;
};

export async function consumePredictReservation(reservation: unknown): Promise<Room<PredictChessState>> {
  // colyseus.js types for seat reservations differ across versions; treat as unknown at runtime.
  type SeatReservationParam = Parameters<Client["consumeSeatReservation"]>[0];
  return getColyseusClient().consumeSeatReservation<PredictChessState>(
    reservation as SeatReservationParam
  );
}

type JoinEntry = {
  promise: Promise<Room<PredictChessState>>;
  room?: Room<PredictChessState>;
  refCount: number;
};

/**
 * React StrictMode (dev) mounts/unmounts effects twice.
 * If two components share the same in-flight join promise, the first cleanup may call `leave()`
 * and disconnect the second mount. We keep a refCount and only leave when the last user releases.
 */
const joins = new Map<string, JoinEntry>();

export async function joinPredictRoom(roomId: string): Promise<Room<PredictChessState>> {
  const existing = joins.get(roomId);
  if (existing) {
    existing.refCount += 1;
    return existing.room ? Promise.resolve(existing.room) : existing.promise;
  }

  // roomId here is the short roomCode used in the URL.
  const resolvedRoomId = await (async () => {
    const res = await fetch(`${apiBase}/match/resolve/${encodeURIComponent(roomId)}`);
    if (!res.ok) throw new MatchMakeError(res.status, "room not found");
    const data = (await res.json()) as { roomId?: string };
    if (!data.roomId) throw new MatchMakeError(404, "room not found");
    return data.roomId;
  })();

  const entry: JoinEntry = {
    refCount: 1,
    promise: getColyseusClient().joinById<PredictChessState>(resolvedRoomId),
  };
  joins.set(roomId, entry);

  entry.promise
    .then((room) => {
      entry.room = room;
      room.onLeave(() => {
        const cur = joins.get(roomId);
        if (cur?.room === room) joins.delete(roomId);
      });
      return room;
    })
    .catch(() => {
      // On join failure, allow retries.
      const cur = joins.get(roomId);
      if (cur === entry) joins.delete(roomId);
    });

  return entry.promise;
}

export async function releasePredictRoom(roomId: string, room: Room<PredictChessState>) {
  const entry = joins.get(roomId);
  if (!entry) {
    await room.leave();
    return;
  }
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0) {
    joins.delete(roomId);
    await room.leave();
  }
}

export async function createMatchRoom(): Promise<CreateRoomResponse> {
  const res = await fetch(`${apiBase}/match/create`, { method: "POST" });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<CreateRoomResponse>;
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
