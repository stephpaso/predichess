import { Room, Client } from "@colyseus/core";
import { PredictChessState, Player, PlannedMove, StepSnapshot, RoundSnapshot } from "../schema/PredictChessState.js";
import { Chess } from "chess.js";
import { loserForIgnoredCheckIfAny, padMovesN, resolveOneStep, type PlannedMoveInput } from "../game/resolver.js";
import { formatRoundHistoryLine } from "../game/roundHistoryLine.js";
import { releaseRoomCode } from "../registry.js";
import { onRoomCreated, onRoomDisposed, onUserConnected, onUserDisconnected } from "../stats.js";
import { normalizeGameMode, pickRandomMidgameFen, type GameMode } from "../utils/fenPool.js";

const TICK_MS = 100;
const MAX_ROUNDS = 40;
const IDLE_DISPOSE_MS = 3 * 60_000;

export class GameRoom extends Room<PredictChessState> {
  maxClients = 2;
  private roomCode: string = "";
  private planMs = 20_000;
  private predictiveSlots = 3;
  private isPublic = true;
  private hostColorPref: "white" | "black" | "random" = "random";
  private gameMode: GameMode = "classic";
  private hostIsWhite = true;
  private planningEndsAt = 0;
  private planningPaused = false;
  private planningPausedRemainingMs = 0;
  private timerInterval?: ReturnType<typeof setInterval>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private ending = false;
  private pendingReconnections = new Set<string>();

  private buildStatus() {
    return {
      roomCode: this.roomCode,
      phase: this.state.phase,
      fen: this.state.fen,
      timerMs: this.state.timerMs,
      roundIndex: this.state.roundIndex,
      winner: this.state.winner,
      gameOverReason: this.state.gameOverReason,
      whiteLocked: this.state.whiteLocked,
      blackLocked: this.state.blackLocked,
      players: [...this.state.players.values()].map((p) => ({
        sessionId: p.sessionId,
        color: p.color,
        connected: p.connected,
      })),
      lastResolutionSteps: this.state.lastResolutionSteps.toArray().map((s) => s.fenAfter),
    };
  }

  private broadcastStatus() {
    this.broadcast("status", this.buildStatus());
  }

  onCreate(
    options: {
      roomCode?: string;
      hostColorPref?: "white" | "black" | "random";
      turnTimeSec?: number;
      predictiveSlots?: number;
      isPublic?: boolean;
      mode?: "classic" | "shuffle";
    } = {}
  ) {
    this.roomCode = options?.roomCode ?? this.roomId;
    this.gameMode = normalizeGameMode(options.mode);
    this.hostColorPref =
      options.hostColorPref === "white" || options.hostColorPref === "black" || options.hostColorPref === "random"
        ? options.hostColorPref
        : "random";
    const turnTimeSec = Math.max(10, Math.min(60, Math.floor(Number(options.turnTimeSec ?? 20) || 0)));
    this.planMs = turnTimeSec * 1000;
    this.predictiveSlots = Math.max(1, Math.min(5, Math.floor(Number(options.predictiveSlots ?? 3) || 0)));
    this.isPublic = options.isPublic !== false;

    this.hostIsWhite =
      this.hostColorPref === "white"
        ? true
        : this.hostColorPref === "black"
          ? false
          : Math.random() < 0.5;

    console.log(`[GameRoom] create roomId=${this.roomId} code=${this.roomCode}`);
    this.setState(new PredictChessState());
    this.state.phase = "lobby";
    this.state.fen = new Chess().fen();
    this.state.timerMs = 0;
    this.state.roundIndex = 0;
    this.state.winner = "";
    this.state.gameOverReason = "";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.lastResolutionSteps.clear();
    this.state.resolvedRounds.clear();
    this.state.historyLog.clear();
    this.state.turnTimeMs = this.planMs;
    this.state.predictiveSlots = this.predictiveSlots;
    this.state.isPublic = this.isPublic;
    this.state.hostColorPref = this.hostColorPref;
    this.state.gameMode = this.gameMode;

    onRoomCreated();
    // Only public rooms should be listed by getAvailableRooms().
    this.setPrivate(!this.isPublic);
    this.setMetadata({
      isPublic: this.isPublic,
      started: false,
      turnTimeSec,
      predictiveSlots: this.predictiveSlots,
      code: this.roomCode,
      gameMode: this.gameMode,
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
    console.log(
      `[GameRoom] join roomId=${this.roomId} code=${this.roomCode} session=${client.sessionId} clients=${this.clients.length}`
    );
    const existing = this.state.players.get(client.sessionId);
    if (existing) {
      existing.connected = true;
    } else {
      const player = new Player();
      player.sessionId = client.sessionId;
      player.connected = true;

      const count = this.clients.length;
      if (count === 1) {
        player.color = this.hostIsWhite ? "white" : "black";
      } else if (count === 2) {
        player.color = this.hostIsWhite ? "black" : "white";
      } else {
        player.color = "spectator";
      }
      this.state.players.set(client.sessionId, player);
    }

    onUserConnected();

    // If the client rejoined via allowReconnection, it's no longer pending.
    this.pendingReconnections.delete(client.sessionId);
    if (this.pendingReconnections.size === 0) this.autoDispose = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.broadcastStatus();

    if (this.clients.length === 2) {
      console.log(`[GameRoom] beginMatch roomId=${this.roomId} code=${this.roomCode}`);
      this.beginMatch();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(
      `[GameRoom] leave roomId=${this.roomId} code=${this.roomCode} session=${client.sessionId} clients=${this.clients.length}`
    );
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    onUserDisconnected();
    this.broadcastStatus();

    // Temporary disconnect: allow up to 3 minutes for reconnection.
    if (!consented) {
      this.pendingReconnections.add(client.sessionId);
      this.autoDispose = false;
      try {
        await this.allowReconnection(client, 180);
        const rejoined = this.state.players.get(client.sessionId);
        if (rejoined) rejoined.connected = true;
        this.pendingReconnections.delete(client.sessionId);
        if (this.pendingReconnections.size === 0) this.autoDispose = true;
        this.broadcastStatus();
        return;
      } catch {
        // reconnection window expired
        this.pendingReconnections.delete(client.sessionId);
        if (this.pendingReconnections.size === 0) this.autoDispose = true;
      }
    }

    // Permanent leave (consented or reconnection timeout)
    const leftColor = p?.color as "white" | "black" | undefined;
    this.state.players.delete(client.sessionId);
    this.broadcastStatus();

    if (this.state.phase !== "finished" && this.state.phase !== "lobby") {
      if (leftColor === "white") this.endGame("black", "disconnect");
      else if (leftColor === "black") this.endGame("white", "disconnect");
    }

    if (this.clients.length === 0 && !this.ending && this.pendingReconnections.size === 0) {
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
    this.state.fen =
      this.gameMode === "shuffle" ? pickRandomMidgameFen() : new Chess().fen();
    this.state.winner = "";
    this.state.gameOverReason = "";
    this.state.roundIndex = 0;
    this.state.resolvedRounds.clear();
    this.state.historyLog.clear();
    // Hide rooms once started; the Join list should only show pre-game lobbies.
    this.setPrivate(true);
    this.setMetadata({
      ...(this.metadata ?? {}),
      started: true,
    });
    console.log(
      `[GameRoom] state->planning roomId=${this.roomId} code=${this.roomCode} (clients=${this.clients.length})`
    );
    this.startPlanningPhase();
  }

  private startPlanningPhase() {
    this.state.phase = "planning";
    this.state.whiteLocked = false;
    this.state.blackLocked = false;
    this.state.whiteMoves.clear();
    this.state.blackMoves.clear();
    this.state.lastResolutionSteps.clear();
    this.planningEndsAt = Date.now() + this.planMs;
    this.planningPaused = false;
    this.planningPausedRemainingMs = 0;
    this.state.timerMs = this.planMs;
    console.log(
      `[GameRoom] planning started roomId=${this.roomId} code=${this.roomCode} endsAt=${this.planningEndsAt}`
    );

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => this.tickPlanning(), TICK_MS);
    this.broadcastStatus();
  }

  private tickPlanning() {
    const shouldPause =
      [...this.state.players.values()].some(
        (pl) => (pl.color === "white" || pl.color === "black") && pl.connected === false
      );

    if (shouldPause) {
      if (!this.planningPaused) {
        this.planningPausedRemainingMs = Math.max(0, this.planningEndsAt - Date.now());
        this.planningPaused = true;
      }
      this.state.timerMs = this.planningPausedRemainingMs;
      this.broadcastStatus();
      return;
    }

    if (this.planningPaused) {
      this.planningEndsAt = Date.now() + this.planningPausedRemainingMs;
      this.planningPaused = false;
    }

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
    if (!player || player.color === "spectator") return;

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
    if (!player || player.color === "spectator") return;

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

  private finalizePlanningAndResolve() {
    if (!this.state.whiteLocked) {
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
    if (!this.state.blackLocked) {
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

    this.runResolution();
  }

  private plannedToInput(arr: typeof this.state.whiteMoves): PlannedMoveInput[] {
    const out: PlannedMoveInput[] = [];
    for (let i = 0; i < arr.length; i++) {
      const m = arr.at(i);
      out.push({ from: m?.from ?? "", to: m?.to ?? "" });
    }
    return padMovesN(out, this.predictiveSlots);
  }

  private runResolution() {
    const wm = this.plannedToInput(this.state.whiteMoves);
    const bm = this.plannedToInput(this.state.blackMoves);

    const ignoredCheckLoser = loserForIgnoredCheckIfAny(this.state.fen, wm, bm);
    if (ignoredCheckLoser) {
      this.endGame(ignoredCheckLoser === "white" ? "black" : "white", "ignored_check");
      return;
    }

    this.state.phase = "resolution";
    this.state.lastResolutionSteps.clear();
    this.broadcastStatus();

    const round = new RoundSnapshot();
    round.roundIndex = this.state.roundIndex;
    round.fenBefore = this.state.fen;

    let fen = this.state.fen;

    for (let i = 0; i < this.predictiveSlots; i++) {
      const step = resolveOneStep(fen, wm[i], bm[i]);
      fen = step.fenAfter;

      const snap = new StepSnapshot();
      snap.fenAfter = fen;
      snap.fenAfterWhite = step.fenAfterWhite ?? "";
      snap.whiteMove = wm[i]?.from && wm[i]?.to ? `${wm[i]!.from}${wm[i]!.to}` : "";
      snap.blackMove = bm[i]?.from && bm[i]?.to ? `${bm[i]!.from}${bm[i]!.to}` : "";
      snap.whiteApplied = !!step.whiteApplied;
      snap.blackApplied = !!step.blackApplied;
      snap.collision = !!step.collision;
      snap.captures.clear();
      for (const c of step.captures ?? []) snap.captures.push(c);
      this.state.lastResolutionSteps.push(snap);

      // Colyseus Schema children must not be referenced from two parents.
      // `lastResolutionSteps` drives the current animation; `round.steps` is persisted history.
      const hist = new StepSnapshot();
      hist.fenAfter = snap.fenAfter;
      hist.fenAfterWhite = snap.fenAfterWhite;
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
        this.state.historyLog.push(formatRoundHistoryLine(round));
        this.endGame(step.winner, "king");
        return;
      }
    }

    this.state.fen = fen;
    round.fenAfter = fen;
    this.state.resolvedRounds.push(round);
    this.state.historyLog.push(formatRoundHistoryLine(round));
    this.state.roundIndex++;

    if (this.state.roundIndex >= MAX_ROUNDS) {
      const winner = this.materialWinner(fen);
      this.endGame(winner, "max_rounds");
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

  private materialWinner(fen: string): "white" | "black" | "draw" {
    const c = new Chess();
    c.load(fen);
    const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let w = 0;
    let b = 0;
    for (const row of c.board()) {
      for (const p of row) {
        if (!p) continue;
        const v = values[p.type] ?? 0;
        if (p.color === "w") w += v;
        else b += v;
      }
    }
    if (w === b) return "draw";
    return w > b ? "white" : "black";
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
    reason: "king" | "checkmate" | "draw" | "disconnect" | "max_rounds" | "resign" | "ignored_check"
  ) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = undefined;
    this.state.phase = "finished";
    this.state.winner = winner;
    this.state.gameOverReason =
      reason === "ignored_check" ? "Sconfitta per mancata uscita dallo scacco" : "";
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
