import express from "express";
import cors from "cors";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import "colyseus";
import { Server, matchMaker } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom.js";
import { generateRoomCode, registerRoomCode, releaseRoomCode, resolveRoomCode } from "./registry.js";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Serve the Vite SPA (client/dist) from the same service in production.
// Render sets NODE_ENV=production by default for Web Services.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
}

app.post("/match/create", async (_req, res) => {
  const roomCode = generateRoomCode(5);
  try {
    const reservation = await matchMaker.create("predict_chess", { roomCode });
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

gameServer.listen(PORT).then(() => {
  console.log(`Predict Chess server listening on http://localhost:${PORT}`);
});
