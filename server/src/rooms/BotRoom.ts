import { Room, Client } from "@colyseus/core";
import { Chess } from "chess.js";
import { PredictChessState, Player, PlannedMove, StepSnapshot, RoundSnapshot } from "../schema/PredictChessState.js";
import { padMovesN, resolveOneStep, type PlannedMoveInput } from "../game/resolver.js";
import { releaseRoomCode } from "../registry.js";
import { onRoomCreated, onRoomDisposed, onUserConnected, onUserDisconnected } from "../stats.js";
import type { IBotEngine } from "../bot/IBotEngine.js";
import { HeuristicEngine } from "../bot/HeuristicEngine.js";

const TICK_MS = 100;
const MAX_ROUNDS = 40;
const IDLE_DISPOSE_MS = 3 * 60_000;
const BOT_SESSION_ID = "BOT";

function withFenTurn(fen: string, turn: "w" | "b"): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return fen;
  parts[1] = turn;
  return parts.join(" ");
}

export class BotRoom extends Room<PredictChessState> {
  maxClients = 1;
  private roomCode: string = "";
  private planMs = 20_000;
  private predictiveSlots = 3;
  private playerColorPref: "white" | "black" | "random" = "random";
  private playerIsWhite = true;
  private botElo = 1000;
  private planningEndsAt = 0;
  private timerInterval?: ReturnType<typeof setInterval>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private ending = false;

  private botEngine: IBotEngine;

  constructor() {
    super();
    this.botEngine = new HeuristicEngine();
  }

  private botColor(): "white" | "black" {
    return this.playerIsWhite ? "black" : "white";
  }

  private buildStatus() {
    return {
      roomCode: this.roomCode,
      phase: this.state.phase,
      fen: this.state.fen,
      timerMs: this.state.timerMs,
      roundIndex: this.state.roundIndex,
      winner: this.state.winner,
      whiteLocked: this.state.whiteLocked,
      blackLocked: this.state.blackLocked,
      players: [...this.state.players.values()].map((p) => ({
        sessionId: p.sessionId,
        color: p.color,
        connected: p.connected,
      })),
      lastResolutionSteps: this.state.lastResolutionSteps.toArray().map((s) => s.fenAfter),
      predictiveSlots: this.state.predictiveSlots,
    };
  }

  private broadcastStatus() {
    this.broadcast("status", this.buildStatus());
  }

  onCreate(
    options: {
      roomCode?: string;
      color?: "white" | "black" | "random";
      predictiveMoves?: number;
      turnTimeSec?: number;
      botElo?: number;
    } = {}
  ) {
    this.roomCode = options?.roomCode ?? this.roomId;
    this.playerColorPref =
      options.color === "white" || options.color === "black" || options.color === "random"
        ? options.color
        : "random";
    const turnTimeSec = Math.max(10, Math.min(60, Math.floor(Number(options.turnTimeSec ?? 20) || 0)));
    this.planMs = turnTimeSec * 1000;
    this.predictiveSlots = Math.max(1, Math.min(5, Math.floor(Number(options.predictiveMoves ?? 3) || 0)));
    this.botElo = Math.max(100, Math.min(3000, Math.floor(Number(options.botElo ?? 1000) || 0)));

    this.playerIsWhite =
      this.playerColorPref === "white"
        ? true
        : this.playerColorPref === "black"
          ? false
          : Math.random() < 0.5;

    console.log(`[BotRoom] create roomId=${this.roomId} code=${this.roomCode} elo=${this.botElo}`);
    this.setState(new PredictChessState());
    this.state.phase = "lobby";
    this.state.fen = new Chess().fen();
    this.state.timerMs = 0;
    this.state.roundIndex = 0;
    this.state.winner = "";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.lastResolutionSteps.clear();
    this.state.resolvedRounds.clear();
    this.state.turnTimeMs = this.planMs;
    this.state.predictiveSlots = this.predictiveSlots;
    this.state.isPublic = false;
    this.state.hostColorPref = "random";

    onRoomCreated();
    this.setPrivate(true);
    this.setMetadata({
      isBot: true,
      started: true,
      predictiveSlots: this.predictiveSlots,
      code: this.roomCode,
      botElo: this.botElo,
    });

    this.onMessage("submit_plan", (client, message: { moves?: PlannedMoveInput[] }) => {
      this.handleSubmitPlan(client, message?.moves ?? []);
    });

    this.onMessage("draft_plan", (client, message: { moves?: PlannedMoveInput[] }) => {
      this.handleDraftPlan(client, message?.moves ?? []);
    });

    this.onMessage("resign", (client) => {
      this.handleResign(client);
    });

    this.onMessage("status_req", (client) => {
      client.send("status", this.buildStatus());
    });
  }

  onJoin(client: Client) {
    console.log(`[BotRoom] join roomId=${this.roomId} code=${this.roomCode} session=${client.sessionId}`);

    // Human player
    const p = new Player();
    p.sessionId = client.sessionId;
    p.connected = true;
    p.color = this.playerIsWhite ? "white" : "black";
    this.state.players.set(client.sessionId, p);

    // Bot "player" (server-side)
    const bot = new Player();
    bot.sessionId = BOT_SESSION_ID;
    bot.connected = true;
    bot.color = this.botColor();
    this.state.players.set(BOT_SESSION_ID, bot);

    onUserConnected();
    this.beginMatch();
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(`[BotRoom] leave roomId=${this.roomId} code=${this.roomCode} session=${client.sessionId}`);
    onUserDisconnected();
    this.broadcastStatus();

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = undefined;

    // If the human leaves mid-game, bot wins by disconnect.
    if (!consented && this.state.phase !== "finished" && this.state.phase !== "lobby") {
      this.endGame(this.playerIsWhite ? "black" : "white", "disconnect");
    }

    if (this.clients.length === 0 && !this.ending) {
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        void this.disconnect();
      }, IDLE_DISPOSE_MS);
    }
  }

  onDispose() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    releaseRoomCode(this.roomCode);
    onRoomDisposed();
  }

  private beginMatch() {
    this.state.fen = new Chess().fen();
    this.state.winner = "";
    this.state.roundIndex = 0;
    this.state.resolvedRounds.clear();
    this.state.phase = "planning";
    this.startPlanningPhase();
  }

  private startPlanningPhase() {
    this.state.phase = "planning";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.whiteMoves.clear();
    this.state.blackMoves.clear();
    this.state.lastResolutionSteps.clear();

    // Pre-fill bot plan for this round (server-side) and lock it immediately.
    this.fillAndLockBotPlan();

    this.planningEndsAt = Date.now() + this.planMs;
    this.state.timerMs = this.planMs;

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickPlanning(), TICK_MS);
    this.broadcastStatus();
  }

  private tickPlanning() {
    const left = Math.max(0, this.planningEndsAt - Date.now());
    this.state.timerMs = left;
    this.broadcastStatus();

    if (left <= 0) {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = undefined;
      this.finalizePlanningAndResolve();
    }
  }

  private handleSubmitPlan(client: Client, moves: PlannedMoveInput[]) {
    if (this.state.phase !== "planning") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.sessionId === BOT_SESSION_ID) return;

    const color = player.color as "white" | "black";
    if (color === "white" && this.state.whiteLocked) return;
    if (color === "black" && this.state.blackLocked) return;

    const padded = padMovesN(
      moves.map((m) => ({ from: m?.from ?? "", to: m?.to ?? "" })),
      this.predictiveSlots
    );

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

    this.broadcastStatus();
  }

  private handleDraftPlan(client: Client, moves: PlannedMoveInput[]) {
    if (this.state.phase !== "planning") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.sessionId === BOT_SESSION_ID) return;

    const color = player.color as "white" | "black";
    if (color === "white" && this.state.whiteLocked) return;
    if (color === "black" && this.state.blackLocked) return;

    const padded = padMovesN(
      moves.map((m) => ({ from: m?.from ?? "", to: m?.to ?? "" })),
      this.predictiveSlots
    );
    const arr = color === "white" ? this.state.whiteMoves : this.state.blackMoves;
    arr.clear();
    for (const m of padded) {
      const pm = new PlannedMove();
      pm.from = m.from;
      pm.to = m.to;
      arr.push(pm);
    }
  }

  private hasAnyPlannedMove(arr: typeof this.state.whiteMoves): boolean {
    for (let i = 0; i < arr.length; i++) {
      const m = arr.at(i);
      if (m?.from && m?.to) return true;
    }
    return false;
  }

  private plannedToInput(arr: typeof this.state.whiteMoves): PlannedMoveInput[] {
    const out: PlannedMoveInput[] = [];
    for (let i = 0; i < arr.length; i++) {
      const m = arr.at(i);
      out.push({ from: m?.from ?? "", to: m?.to ?? "" });
    }
    return padMovesN(out, this.predictiveSlots);
  }

  private finalizePlanningAndResolve() {
    // Auto-lock human side with whatever draft exists (or empty plan), same as multiplayer.
    const humanColor = this.playerIsWhite ? "white" : "black";
    if (humanColor === "white" && !this.state.whiteLocked) {
      const keep = this.hasAnyPlannedMove(this.state.whiteMoves);
      const src = keep ? this.plannedToInput(this.state.whiteMoves) : padMovesN([], this.predictiveSlots);
      this.state.whiteMoves.clear();
      for (const m of src) {
        const pm = new PlannedMove();
        pm.from = m.from;
        pm.to = m.to;
        this.state.whiteMoves.push(pm);
      }
      this.state.whiteLocked = true;
    }
    if (humanColor === "black" && !this.state.blackLocked) {
      const keep = this.hasAnyPlannedMove(this.state.blackMoves);
      const src = keep ? this.plannedToInput(this.state.blackMoves) : padMovesN([], this.predictiveSlots);
      this.state.blackMoves.clear();
      for (const m of src) {
        const pm = new PlannedMove();
        pm.from = m.from;
        pm.to = m.to;
        this.state.blackMoves.push(pm);
      }
      this.state.blackLocked = true;
    }

    // Bot is already locked from startPlanningPhase.
    this.runResolution();
  }

  private fillAndLockBotPlan() {
    const botColor = this.botColor();
    const isBotWhite = botColor === "white";

    // Ensure the engine predicts for the bot side, regardless of the FEN active color.
    const fenForBot = withFenTurn(this.state.fen, isBotWhite ? "w" : "b");
    const seq = this.botEngine.predictSequence(fenForBot, this.predictiveSlots, this.botElo);
    const arr = isBotWhite ? this.state.whiteMoves : this.state.blackMoves;
    arr.clear();
    for (let i = 0; i < this.predictiveSlots; i++) {
      const uci = seq[i] ?? "";
      const parsed = HeuristicEngine.parseUci(uci);
      const pm = new PlannedMove();
      pm.from = parsed?.from ?? "";
      pm.to = parsed?.to ?? "";
      arr.push(pm);
    }

    if (isBotWhite) this.state.whiteLocked = true;
    else this.state.blackLocked = true;
  }

  private runResolution() {
    this.state.phase = "resolution";
    this.state.lastResolutionSteps.clear();
    this.broadcastStatus();

    const round = new RoundSnapshot();
    round.roundIndex = this.state.roundIndex;
    round.fenBefore = this.state.fen;

    let fen = this.state.fen;
    const wm = this.plannedToInput(this.state.whiteMoves);
    const bm = this.plannedToInput(this.state.blackMoves);

    for (let i = 0; i < this.predictiveSlots; i++) {
      const step = resolveOneStep(fen, wm[i], bm[i]);
      fen = step.fenAfter;

      const snap = new StepSnapshot();
      snap.fenAfter = fen;
      snap.whiteMove = wm[i]?.from && wm[i]?.to ? `${wm[i]!.from}${wm[i]!.to}` : "";
      snap.blackMove = bm[i]?.from && bm[i]?.to ? `${bm[i]!.from}${bm[i]!.to}` : "";
      snap.whiteApplied = !!step.whiteApplied;
      snap.blackApplied = !!step.blackApplied;
      snap.collision = !!step.collision;
      snap.captures.clear();
      for (const c of step.captures ?? []) snap.captures.push(c);
      this.state.lastResolutionSteps.push(snap);

      const hist = new StepSnapshot();
      hist.fenAfter = snap.fenAfter;
      hist.whiteMove = snap.whiteMove;
      hist.blackMove = snap.blackMove;
      hist.whiteApplied = snap.whiteApplied;
      hist.blackApplied = snap.blackApplied;
      hist.collision = snap.collision;
      hist.captures.clear();
      for (const c of snap.captures.toArray()) hist.captures.push(c);
      round.steps.push(hist);

      if (step.gameOver && step.winner) {
        this.state.fen = fen;
        round.fenAfter = fen;
        this.state.resolvedRounds.push(round);
        this.endGame(step.winner, "king");
        return;
      }
    }

    this.state.fen = fen;
    round.fenAfter = fen;
    this.state.resolvedRounds.push(round);
    this.state.roundIndex++;

    if (this.state.roundIndex >= MAX_ROUNDS) {
      this.endGame("draw", "max_rounds");
      return;
    }

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

  private handleResign(client: Client) {
    if (this.state.phase === "finished" || this.ending) return;
    const p = this.state.players.get(client.sessionId);
    const color = p?.color;
    if (color === "white") this.endGame("black", "resign");
    else if (color === "black") this.endGame("white", "resign");
  }

  private endGame(
    winner: "white" | "black" | "draw",
    _reason: "king" | "checkmate" | "draw" | "disconnect" | "max_rounds" | "resign"
  ) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = undefined;
    this.state.phase = "finished";
    this.state.winner = winner;
    this.state.timerMs = 0;
    this.broadcastStatus();
    if (!this.ending) {
      this.ending = true;
      setTimeout(() => {
        void this.disconnect();
      }, 800);
    }
  }
}

