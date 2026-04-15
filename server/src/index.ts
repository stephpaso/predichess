import express from "express";
import cors from "cors";
import { createServer } from "http";
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

const httpServer = createServer(app);
const gameServer = new Server({
  server: httpServer,
});

gameServer.define("predict_chess", GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Predict Chess server listening on http://localhost:${PORT}`);
});
