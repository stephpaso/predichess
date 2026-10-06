import express from "express";
import cors from "cors";
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
import { rateLimit } from "./utils/rateLimit.js";

const PORT = Number(process.env.PORT) || 2567;

const app = express();

/** Optional comma-separated allowlist; unset = reflect request origin (SPA same-origin ok). */
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors(
    corsOrigins.length > 0
      ? { origin: corsOrigins, methods: ["GET", "POST", "OPTIONS"] }
      : { origin: true, methods: ["GET", "POST", "OPTIONS"] }
  )
);

app.use(express.json({ limit: "16kb" }));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // API + WS app; CSP left permissive for the SPA assets served from the same origin.
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});

function clientIp(req: express.Request): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length > 0) return xf.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

function enforceCreateRateLimit(req: express.Request, res: express.Response): boolean {
  const { allowed, retryAfterSec } = rateLimit({
    key: `create:${clientIp(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!allowed) {
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "rate_limited" });
    return false;
  }
  return true;
}

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

app.post("/match/create", async (req, res) => {
  if (!enforceCreateRateLimit(req, res)) return;

  const roomCode = generateRoomCode(5);
  const body = (req.body ?? {}) as {
    hostColorPref?: "white" | "black" | "random";
    turnTimeSec?: number;
    predictiveSlots?: number;
    isPublic?: boolean;
    mode?: "classic" | "shuffle";
  };
  const turnTimeSecRaw = Number(body.turnTimeSec ?? 20);
  const predictiveSlotsRaw = Number(body.predictiveSlots ?? 3);
  const isPublic = body.isPublic !== false;
  const hostColorPref =
    body.hostColorPref === "white" || body.hostColorPref === "black" || body.hostColorPref === "random"
      ? body.hostColorPref
      : "random";

  const mode = body.mode === "shuffle" ? "shuffle" : "classic";

  const turnTimeSec = Math.max(10, Math.min(60, Math.floor(turnTimeSecRaw || 0)));
  const predictiveSlots = Math.max(1, Math.min(5, Math.floor(predictiveSlotsRaw || 0)));
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

app.post("/bot/create", async (req, res) => {
  if (!enforceCreateRateLimit(req, res)) return;

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
  const turnTimeSec = Math.max(10, Math.min(60, Math.floor(Number(body.turnTimeSec ?? 20) || 0)));
  const predictiveMoves = Math.max(1, Math.min(5, Math.floor(Number(body.predictiveMoves ?? 3) || 0)));
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

// SPA fallback (must be after API routes)
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
