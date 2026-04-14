import { Room, Client } from "colyseus";
import { PredictChessState, Player, PlannedMove, StepSnapshot } from "../schema/PredictChessState.js";
import { Chess } from "chess.js";
import { padMoves, resolveOneStep, type PlannedMoveInput } from "../game/resolver.js";
import { releaseRoomCode } from "../registry.js";

const PLAN_MS = 20_000;
const TICK_MS = 100;

export class GameRoom extends Room<PredictChessState> {
  maxClients = 2;
  private roomCode: string = "";
  private planningEndsAt = 0;
  private timerInterval?: ReturnType<typeof setInterval>;

  onCreate(options: { roomCode?: string }) {
    if (options?.roomCode) {
      this.roomId = options.roomCode;
    }
    this.roomCode = this.roomId;
    this.setState(new PredictChessState());
    this.state.phase = "lobby";
    this.state.fen = new Chess().fen();
    this.state.timerMs = 0;
    this.state.roundIndex = 0;
    this.state.winner = "";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.lastResolutionSteps.clear();

    this.onMessage("submit_plan", (client, message: { moves?: PlannedMoveInput[] }) => {
      this.handleSubmitPlan(client, message?.moves ?? []);
    });
  }

  onJoin(client: Client) {
    const player = new Player();
    player.sessionId = client.sessionId;
    player.connected = true;

    const count = this.clients.length;
    if (count === 1) {
      player.color = "white";
    } else if (count === 2) {
      player.color = "black";
    } else {
      player.color = "spectator";
    }

    this.state.players.set(client.sessionId, player);

    if (this.clients.length === 2) {
      this.beginMatch();
    }
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;

    if (this.state.phase !== "finished" && this.state.phase !== "lobby") {
      const left = p?.color;
      if (left === "white") {
        this.endGame("black", "disconnect");
      } else if (left === "black") {
        this.endGame("white", "disconnect");
      }
    }

    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    releaseRoomCode(this.roomCode);
  }

  private beginMatch() {
    this.state.fen = new Chess().fen();
    this.state.winner = "";
    this.state.roundIndex = 0;
    this.startPlanningPhase();
  }

  private startPlanningPhase() {
    this.state.phase = "planning";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.whiteMoves.clear();
    this.state.blackMoves.clear();
    this.state.lastResolutionSteps.clear();
    this.planningEndsAt = Date.now() + PLAN_MS;
    this.state.timerMs = PLAN_MS;

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickPlanning(), TICK_MS);
  }

  private tickPlanning() {
    const left = Math.max(0, this.planningEndsAt - Date.now());
    this.state.timerMs = left;

    if (left <= 0) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = undefined;
      this.finalizePlanningAndResolve();
    }
  }

  private handleSubmitPlan(client: Client, moves: PlannedMoveInput[]) {
    if (this.state.phase !== "planning") return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.color === "spectator") return;

    const color = player.color as "white" | "black";
    if (color === "white" && this.state.whiteLocked) return;
    if (color === "black" && this.state.blackLocked) return;

    const padded = padMoves(moves.map((m) => ({ from: m?.from ?? "", to: m?.to ?? "" })));

    const arr = color === "white" ? this.state.whiteMoves : this.state.blackMoves;
    arr.clear();
    for (const m of padded) {
      const pm = new PlannedMove();
      pm.from = m.from;
      pm.to = m.to;
      arr.push(pm);
    }

    if (color === "white") this.state.whiteLocked = true;
    else this.state.blackLocked = true;

    if (this.state.whiteLocked && this.state.blackLocked) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = undefined;
      this.finalizePlanningAndResolve();
    }
  }

  private finalizePlanningAndResolve() {
    if (!this.state.whiteLocked) {
      this.state.whiteMoves.clear();
      for (const m of padMoves([])) {
        const pm = new PlannedMove();
        pm.from = m.from;
        pm.to = m.to;
        this.state.whiteMoves.push(pm);
      }
      this.state.whiteLocked = true;
    }
    if (!this.state.blackLocked) {
      this.state.blackMoves.clear();
      for (const m of padMoves([])) {
        const pm = new PlannedMove();
        pm.from = m.from;
        pm.to = m.to;
        this.state.blackMoves.push(pm);
      }
      this.state.blackLocked = true;
    }

    this.runResolution();
  }

  private plannedToInput(arr: typeof this.state.whiteMoves): PlannedMoveInput[] {
    const out: PlannedMoveInput[] = [];
    for (let i = 0; i < arr.length; i++) {
      const m = arr.at(i);
      out.push({ from: m?.from ?? "", to: m?.to ?? "" });
    }
    return padMoves(out);
  }

  private runResolution() {
    this.state.phase = "resolution";
    this.state.lastResolutionSteps.clear();

    let fen = this.state.fen;
    const wm = this.plannedToInput(this.state.whiteMoves);
    const bm = this.plannedToInput(this.state.blackMoves);

    for (let i = 0; i < 5; i++) {
      const step = resolveOneStep(fen, wm[i], bm[i]);
      fen = step.fenAfter;

      const snap = new StepSnapshot();
      snap.fenAfter = fen;
      this.state.lastResolutionSteps.push(snap);

      if (step.gameOver && step.winner) {
        this.state.fen = fen;
        this.endGame(step.winner, "king");
        return;
      }
    }

    this.state.fen = fen;
    this.state.roundIndex++;

    const chess = new Chess();
    chess.load(fen);
    if (chess.isCheckmate()) {
      const loser = chess.turn();
      this.endGame(loser === "w" ? "black" : "white", "checkmate");
      return;
    }
    if (chess.isDraw()) {
      this.endGame("draw", "draw");
      return;
    }

    this.startPlanningPhase();
  }

  private endGame(
    winner: "white" | "black" | "draw",
    _reason: "king" | "checkmate" | "draw" | "disconnect"
  ) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = undefined;
    this.state.phase = "finished";
    this.state.winner = winner;
    this.state.timerMs = 0;
  }
}
