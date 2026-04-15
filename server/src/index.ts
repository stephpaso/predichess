import express from "express";
import cors from "cors";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import "colyseus";
import { Server, matchMaker } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom.js";
import { BotRoom } from "./rooms/BotRoom.js";
import { generateRoomCode, registerRoomCode, releaseRoomCode, resolveRoomCode } from "./registry.js";
import { getLiveStats } from "./stats.js";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/stats", (_req, res) => {
  res.json({ ok: true, ...getLiveStats() });
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
  const roomCode = generateRoomCode(5);
  const body = (req.body ?? {}) as {
    hostColorPref?: "white" | "black" | "random";
    turnTimeSec?: number;
    predictiveSlots?: number;
    isPublic?: boolean;
  };
  const turnTimeSecRaw = Number(body.turnTimeSec ?? 20);
  const predictiveSlotsRaw = Number(body.predictiveSlots ?? 3);
  const isPublic = body.isPublic !== false;
  const hostColorPref =
    body.hostColorPref === "white" || body.hostColorPref === "black" || body.hostColorPref === "random"
      ? body.hostColorPref
      : "random";

  const turnTimeSec = Math.max(10, Math.min(60, Math.floor(turnTimeSecRaw || 0)));
  const predictiveSlots = Math.max(1, Math.min(5, Math.floor(predictiveSlotsRaw || 0)));
  try {
    const reservation = await matchMaker.create("predict_chess", {
      roomCode,
      hostColorPref,
      turnTimeSec,
      predictiveSlots,
      isPublic,
    });
    registerRoomCode(roomCode, reservation.room.roomId);
    res.json({
      roomId: reservation.room.roomId,
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
  const roomCode = generateRoomCode(5);
  const body = (req.body ?? {}) as {
    botElo?: number;
    color?: "white" | "black" | "random";
    predictiveMoves?: number;
    turnTimeSec?: number;
  };
  const botElo = Math.max(100, Math.min(3000, Math.floor(Number(body.botElo ?? 1000) || 0)));
  const color = body.color === "white" || body.color === "black" || body.color === "random" ? body.color : "random";
  const turnTimeSec = Math.max(10, Math.min(60, Math.floor(Number(body.turnTimeSec ?? 20) || 0)));
  const predictiveMoves = Math.max(1, Math.min(5, Math.floor(Number(body.predictiveMoves ?? 3) || 0)));

  try {
    const reservation = await matchMaker.create("bot_chess", {
      roomCode,
      botElo,
      color,
      predictiveMoves,
      turnTimeSec,
    });
    registerRoomCode(roomCode, reservation.room.roomId);
    res.json({
      roomId: reservation.room.roomId,
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
  const code = String(req.params.code ?? "").toUpperCase();
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
  server: httpServer,
});

gameServer.define("predict_chess", GameRoom);
gameServer.define("bot_chess", BotRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Predict Chess server listening on http://localhost:${PORT}`);
});
