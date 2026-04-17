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

  const { protocol, hostname, port, host } = window.location;

  // Local dev: Vite runs on 5173 (or similar) and the Colyseus server on 2567.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//127.0.0.1:2567`;
  }

  // Production: when serving the SPA from the same Render service, do NOT hardcode :2567.
  // Use the current origin host (domain + optional port).
  if (!port) {
    return `${protocol}//${host}`;
  }

  return `${protocol}//${host}`;
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

export type GameModeOption = "classic" | "shuffle";

export type MatchRoomOptions = {
  hostColorPref: "white" | "black" | "random";
  turnTimeSec: number; // 10-60
  predictiveSlots: number; // 1-5
  isPublic: boolean;
  mode?: GameModeOption;
};

export async function consumePredictReservation(reservation: unknown): Promise<Room<PredictChessState>> {
  // colyseus.js types for seat reservations differ across versions; treat as unknown at runtime.
  type SeatReservationParam = Parameters<Client["consumeSeatReservation"]>[0];
  return getColyseusClient().consumeSeatReservation<PredictChessState>(
    reservation as SeatReservationParam
  );
}

/**
 * Consume a reservation but also register it under the short roomCode key so
 * StrictMode double-mount cleanup doesn't immediately disconnect the second mount.
 */
export async function consumePredictReservationForCode(
  roomCode: string,
  reservation: unknown
): Promise<Room<PredictChessState>> {
  const room = await consumePredictReservation(reservation);
  const existing = joins.get(roomCode);
  if (existing?.room) {
    // If something already joined, prefer it and leave this one.
    await room.leave();
    existing.refCount += 1;
    return existing.room;
  }
  const entry: JoinEntry = {
    refCount: 1,
    promise: Promise.resolve(room),
    room,
  };
  joins.set(roomCode, entry);
  room.onLeave(() => {
    const cur = joins.get(roomCode);
    if (cur?.room === room) joins.delete(roomCode);
  });
  return room;
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
    if (!res.ok) throw new MatchMakeError("room not found", res.status);
    const data = (await res.json()) as { roomId?: string };
    if (!data.roomId) throw new MatchMakeError("room not found", 404);
    return data.roomId;
  })();

  return joinPredictRoomByResolvedId(roomId, resolvedRoomId);
}

export async function joinPredictRoomByResolvedId(
  roomCode: string,
  resolvedRoomId: string
): Promise<Room<PredictChessState>> {
  const existing = joins.get(roomCode);
  if (existing) {
    existing.refCount += 1;
    return existing.room ? Promise.resolve(existing.room) : existing.promise;
  }

  const entry: JoinEntry = {
    refCount: 1,
    promise: getColyseusClient().joinById<PredictChessState>(resolvedRoomId),
  };
  joins.set(roomCode, entry);

  entry.promise
    .then((room) => {
      entry.room = room;
      room.onLeave(() => {
        const cur = joins.get(roomCode);
        if (cur?.room === room) joins.delete(roomCode);
      });
      return room;
    })
    .catch(() => {
      // On join failure, allow retries.
      const cur = joins.get(roomCode);
      if (cur === entry) joins.delete(roomCode);
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
    // React StrictMode can briefly drop refCount to 0 between the two mounts.
    // Delay the actual leave to allow the second mount to re-acquire.
    window.setTimeout(() => {
      const cur = joins.get(roomId);
      if (!cur) return;
      if (cur.refCount !== 0) return;
      joins.delete(roomId);
      void room.leave();
    }, 0);
  }
}

export async function createMatchRoom(options: Partial<MatchRoomOptions> = {}): Promise<CreateRoomResponse> {
  const res = await fetch(`${apiBase}/match/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<CreateRoomResponse>;
}

export type CreateBotRoomOptions = {
  botElo: number;
  color: "white" | "black" | "random";
  predictiveMoves: number; // 1-5
  turnTimeSec?: number; // optional (defaults server-side)
  mode?: GameModeOption;
};

export async function createBotRoom(options: Partial<CreateBotRoomOptions> = {}): Promise<CreateRoomResponse> {
  const res = await fetch(`${apiBase}/bot/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error("create_failed");
  return res.json() as Promise<CreateRoomResponse>;
}

export type AvailableRoomRow = {
  roomId: string;
  clients: number;
  maxClients: number;
  metadata?: Record<string, unknown>;
};

export async function getAvailablePredictRooms(): Promise<AvailableRoomRow[]> {
  const rooms = (await getColyseusClient().getAvailableRooms("predict_chess")) as AvailableRoomRow[];
  return rooms ?? [];
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
