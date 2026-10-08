import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";
import { BotRoom } from "./rooms/BotRoom.js";
import { generateRoomCode, registerRoomCode, releaseRoomCode, resolveRoomCode } from "./registry.js";
import { getLiveStats } from "./stats.js";
import { clampPredictiveSlots, clampTurnTimeSec } from "./game/matchOptions.js";

const PORT = Number(process.env.PORT) || 2567;

const app = express();

/**
 * CORS: explicit allowlist from CORS_ORIGIN (comma-separated).
 * When unset, disable cross-origin CORS (same-origin SPA on this service).
 * Never use origin:true / wildcard reflection — CodeQL js/cors-permissive-configuration.
 */
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Resolve Allow-Origin only from the allowlist (never reflect raw Origin / never *). */
function allowedCorsOrigin(requestOrigin: string | null): string {
  if (!requestOrigin || corsOrigins.length === 0) return "";
  const idx = corsOrigins.indexOf(requestOrigin);
  return idx >= 0 ? corsOrigins[idx]! : "";
}

app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Colyseus prepends CORS on every HTTP response via matchMaker.controller —
// default getCorsHeaders reflects any Origin. Override to the same allowlist.
matchMaker.controller.DEFAULT_CORS_HEADERS = {
  ...matchMaker.controller.DEFAULT_CORS_HEADERS,
  "Access-Control-Allow-Origin": "",
};
matchMaker.controller.getCorsHeaders = (headers: Headers) => ({
  "Access-Control-Allow-Origin": allowedCorsOrigin(headers.get("origin")),
});

app.use(express.json({ limit: "16kb" }));

/** Global limiter — covers FS access (sendFile / static) for CodeQL js/missing-rate-limiting. */
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});
app.use(globalLimiter);

/** Tighter limit on room-creation endpoints (resource-intensive matchMaker.create). */
const createLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // API + WS app; CSP left permissive for the SPA assets served from the same origin.
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/stats", (_req, res) => {
  res.json({ ok: true, ...getLiveStats() });
});

/** Public lobby listing (replaces legacy `client.getAvailableRooms` removed from @colyseus/sdk 0.17). */
app.get("/match/available", async (_req, res) => {
  try {
    const rooms = await matchMaker.query({
      name: "predict_chess",
      private: false,
    });
    res.json(
      rooms.map((r) => ({
        roomId: r.roomId,
        clients: r.clients ?? 0,
        maxClients: r.maxClients ?? 2,
        metadata: r.metadata,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "query_failed" });
  }
});

// Serve the Vite SPA (client/dist) from the same service in production.
// Render sets NODE_ENV=production by default for Web Services.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
}

app.post("/match/create", createLimiter, async (req, res) => {
  const roomCode = generateRoomCode(5);
  const body = (req.body ?? {}) as {
    hostColorPref?: "white" | "black" | "random";
    turnTimeSec?: number;
    predictiveSlots?: number;
    isPublic?: boolean;
    mode?: "classic" | "shuffle";
  };
  const turnTimeSecRaw = body.turnTimeSec;
  const predictiveSlotsRaw = body.predictiveSlots;
  const isPublic = body.isPublic !== false;
  const hostColorPref =
    body.hostColorPref === "white" || body.hostColorPref === "black" || body.hostColorPref === "random"
      ? body.hostColorPref
      : "random";

  const mode = body.mode === "shuffle" ? "shuffle" : "classic";

  const turnTimeSec = clampTurnTimeSec(turnTimeSecRaw);
  const predictiveSlots = clampPredictiveSlots(predictiveSlotsRaw);
  try {
    const reservation = await matchMaker.create("predict_chess", {
      roomCode,
      hostColorPref,
      turnTimeSec,
      predictiveSlots,
      isPublic,
      mode,
    });
    registerRoomCode(roomCode, reservation.roomId);
    res.json({
      roomId: reservation.roomId,
      roomCode,
      // Send through as-is; client will consume it.
      reservation,
    });
  } catch (e) {
    releaseRoomCode(roomCode);
    console.error(e);
    res.status(500).json({ error: "create_failed" });
  }
});

app.post("/bot/create", createLimiter, async (req, res) => {
  const roomCode = generateRoomCode(5);
  const body = (req.body ?? {}) as {
    botElo?: number;
    color?: "white" | "black" | "random";
    predictiveMoves?: number;
    turnTimeSec?: number;
    mode?: "classic" | "shuffle";
  };
  const botElo = Math.max(100, Math.min(3000, Math.floor(Number(body.botElo ?? 1000) || 0)));
  const color = body.color === "white" || body.color === "black" || body.color === "random" ? body.color : "random";
  const turnTimeSec = clampTurnTimeSec(body.turnTimeSec);
  const predictiveMoves = clampPredictiveSlots(body.predictiveMoves);
  const mode = body.mode === "shuffle" ? "shuffle" : "classic";

  try {
    const reservation = await matchMaker.create("bot_chess", {
      roomCode,
      botElo,
      color,
      predictiveMoves,
      turnTimeSec,
      mode,
    });
    registerRoomCode(roomCode, reservation.roomId);
    res.json({
      roomId: reservation.roomId,
      roomCode,
      reservation,
    });
  } catch (e) {
    releaseRoomCode(roomCode);
    console.error(e);
    res.status(500).json({ error: "create_failed" });
  }
});

app.get("/match/resolve/:code", (req, res) => {
  const raw = String(req.params.code ?? "");
  // Only accept short room codes from our alphabet (prevents oversized / odd lookups).
  if (!/^[A-Za-z0-9]{1,16}$/.test(raw)) {
    res.status(400).json({ error: "invalid_code" });
    return;
  }
  const code = raw.toUpperCase();
  const roomId = resolveRoomCode(code);
  if (!roomId) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ roomId });
});

// SPA fallback (must be after API routes) — sendFile is FS access; covered by globalLimiter.
app.get("*", (_req, res) => {
  const indexPath = path.join(clientDistPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.status(404).send("client_not_built");
    return;
  }
  res.sendFile(indexPath);
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define("predict_chess", GameRoom);
gameServer.define("bot_chess", BotRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Predict Chess server listening on http://0.0.0.0:${PORT}`);
});
