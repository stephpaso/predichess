import express from "express";
import cors from "cors";
import { createServer } from "http";
import "colyseus";
import { Server, matchMaker } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom.js";
import { generateRoomCode, releaseRoomCode } from "./registry.js";

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
    res.json({ roomId: reservation.room.roomId, roomCode });
  } catch (e) {
    releaseRoomCode(roomCode);
    console.error(e);
    res.status(500).json({ error: "create_failed" });
  }
});

const httpServer = createServer(app);
const gameServer = new Server({
  server: httpServer,
});

gameServer.define("predict_chess", GameRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Predict Chess server listening on http://localhost:${PORT}`);
});
