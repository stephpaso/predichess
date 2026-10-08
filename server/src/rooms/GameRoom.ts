import { Room, Client, CloseCode } from "@colyseus/core";
import { PredictChessState, Player, PlannedMove, RoundSnapshot } from "../schema/PredictChessState.js";
import { Chess } from "chess.js";
import { loserForIgnoredCheckIfAny, padMovesN, safeLoadChess, type PlannedMoveInput } from "../game/resolver.js";
import { formatRoundHistoryLine } from "../game/roundHistoryLine.js";
import { serializeRoundResolvedPayload } from "../game/roundResolvedBroadcast.js";
import { appendResolvedSteps, resolvePlannedRound } from "../game/roundResolution.js";
import {
  allowBidRate,
  parseBidPayload,
  TOKEN_START,
  tokensAtPlanningStart,
  type InitiativeBid,
} from "../game/initiative.js";
import { kingCaptureWinner } from "../game/kings.js";
import {
  advanceEmptyPlanStreaks,
  disqualificationWinner,
  emptyPlanDqMessage,
  type EmptyPlanStreaks,
} from "../game/emptyPlans.js";
import { clampPredictiveSlots, clampTurnTimeSec, PLAN_TIME_SEC_DEFAULT, PREDICTIVE_SLOTS_DEFAULT } from "../game/matchOptions.js";
import { registerRoomCode, releaseRoomCode } from "../registry.js";
import { onRoomCreated, onRoomDisposed, onUserConnected, onUserDisconnected } from "../stats.js";
import { normalizeGameMode, pickRandomMidgameFen, type GameMode } from "../utils/fenPool.js";

const TICK_MS = 100;
const IDLE_DISPOSE_MS = 3 * 60_000;

function planHasAnyMove(moves: PlannedMoveInput[]): boolean {
  return moves.some((m) => !!m.from && !!m.to);
}

export class GameRoom extends Room<{ state: PredictChessState }> {
  maxClients = 2;
  private roomCode: string = "";
  private planMs = PLAN_TIME_SEC_DEFAULT * 1000;
  private predictiveSlots = PREDICTIVE_SLOTS_DEFAULT;
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
  private emptyPlanStreaks: EmptyPlanStreaks = { white: 0, black: 0 };
  private whiteBid: InitiativeBid | null = null;
  private blackBid: InitiativeBid | null = null;
  private planningRoundsStarted = 0;
  private resolving = false;
  private bidHits = new Map<string, number[]>();

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
      whiteTokens: this.state.whiteTokens,
      blackTokens: this.state.blackTokens,
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

  async onCreate(
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
    const turnTimeSec = clampTurnTimeSec(options.turnTimeSec);
    this.planMs = turnTimeSec * 1000;
    this.predictiveSlots = clampPredictiveSlots(options.predictiveSlots);
    this.isPublic = options.isPublic !== false;

    this.hostIsWhite =
      this.hostColorPref === "white"
        ? true
        : this.hostColorPref === "black"
          ? false
          : Math.random() < 0.5;

    console.log(`[GameRoom] create roomId=${this.roomId} code=${this.roomCode}`);
    registerRoomCode(this.roomCode, this.roomId);
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
    await this.setPrivate(!this.isPublic);
    await this.setMetadata({
      isPublic: this.isPublic,
      started: false,
      turnTimeSec,
      predictiveSlots: this.predictiveSlots,
      code: this.roomCode,
      gameMode: this.gameMode,
    });

    this.onMessage("submit_plan", (client, message: { moves?: PlannedMoveInput[]; bid?: unknown }) => {
      this.handleSubmitPlan(client, message?.moves ?? [], message);
    });

    this.onMessage("draft_plan", (client, message: { moves?: PlannedMoveInput[] }) => {
      this.handleDraftPlan(client, message?.moves ?? []);
    });

    this.onMessage("set_bid", (client, message: unknown) => {
      this.handleSetBid(client, message);
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

    if (this.state.phase === "planning") this.sendOwnBid(client);

    // Reconnect must not restart the match or reset token balances.
    if (this.clients.length === 2 && this.state.phase === "lobby") {
      console.log(`[GameRoom] beginMatch roomId=${this.roomId} code=${this.roomCode}`);
      void this.beginMatch();
    }
  }

  async onLeave(client: Client, code: number) {
    const consented = code === CloseCode.CONSENTED;
    console.log(
      `[GameRoom] leave roomId=${this.roomId} code=${this.roomCode} session=${client.sessionId} clients=${this.clients.length}`
    );
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;
    onUserDisconnected();
    this.broadcastStatus();

    // Temporary disconnect (e.g. page refresh): keep seat for reconnection window.
    if (!consented) {
      this.pendingReconnections.add(client.sessionId);
      this.autoDispose = false;
      try {
        await this.allowReconnection(client, 30);
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

  private async beginMatch() {
    this.state.fen =
      this.gameMode === "shuffle" ? pickRandomMidgameFen() : new Chess().fen();
    this.state.winner = "";
    this.state.gameOverReason = "";
    this.state.roundIndex = 0;
    this.state.resolvedRounds.clear();
    this.state.historyLog.clear();
    this.emptyPlanStreaks = { white: 0, black: 0 };
    // Hide rooms once started; the Join list should only show pre-game lobbies.
    await this.setPrivate(true);
    await this.setMetadata({
      ...(this.metadata ?? {}),
      started: true,
    });
    console.log(
      `[GameRoom] state->planning roomId=${this.roomId} code=${this.roomCode} (clients=${this.clients.length})`
    );
    this.startPlanningPhase();
  }

  private refreshTokensForPlanning() {
    if (this.planningRoundsStarted === 0) {
      this.state.whiteTokens = TOKEN_START;
      this.state.blackTokens = TOKEN_START;
    } else {
      this.state.whiteTokens = tokensAtPlanningStart(this.state.whiteTokens);
      this.state.blackTokens = tokensAtPlanningStart(this.state.blackTokens);
    }
    this.planningRoundsStarted += 1;
    this.whiteBid = null;
    this.blackBid = null;
  }

  private sendOwnBid(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || (player.color !== "white" && player.color !== "black")) return;
    const bid = player.color === "white" ? this.whiteBid : this.blackBid;
    client.send("my_bid", bid ? { slot: bid.slot, amount: bid.amount } : { slot: -1, amount: 0 });
  }

  private handleSetBid(client: Client, message: unknown) {
    if (this.state.phase !== "planning" || this.resolving) return;
    const player = this.state.players.get(client.sessionId);
    if (!player || (player.color !== "white" && player.color !== "black")) return;
    const color = player.color as "white" | "black";
    if (color === "white" && this.state.whiteLocked) return;
    if (color === "black" && this.state.blackLocked) return;

    const rate = allowBidRate(this.bidHits.get(client.sessionId) ?? [], Date.now());
    this.bidHits.set(client.sessionId, rate.hits);
    if (!rate.ok) return;

    const tokens = color === "white" ? this.state.whiteTokens : this.state.blackTokens;
    const parsed = parseBidPayload(message, this.predictiveSlots, tokens);
    if (!parsed.ok) {
      client.send("bid_rejected", { reason: "invalid" });
      return;
    }
    if (color === "white") this.whiteBid = parsed.bid;
    else this.blackBid = parsed.bid;
    this.sendOwnBid(client);
  }

  private lockBidFromSubmit(client: Client, color: "white" | "black", message: { bid?: unknown }): boolean {
    if (!message || !Object.prototype.hasOwnProperty.call(message, "bid")) return true;
    const tokens = color === "white" ? this.state.whiteTokens : this.state.blackTokens;
    const parsed = parseBidPayload(message.bid, this.predictiveSlots, tokens);
    if (!parsed.ok) {
      client.send("bid_rejected", { reason: "invalid" });
      return false;
    }
    if (color === "white") this.whiteBid = parsed.bid;
    else this.blackBid = parsed.bid;
    return true;
  }

  private startPlanningPhase() {
    this.resolving = false;
    this.refreshTokensForPlanning();
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
    for (const client of this.clients) this.sendOwnBid(client);
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

  private handleSubmitPlan(client: Client, moves: PlannedMoveInput[], message?: { bid?: unknown }) {
    if (this.state.phase !== "planning" || this.resolving) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.color === "spectator") return;

    const color = player.color as "white" | "black";
    if (color === "white" && this.state.whiteLocked) return;
    if (color === "black" && this.state.blackLocked) return;

    if (message && !this.lockBidFromSubmit(client, color, message)) return;

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
    if (this.resolving || this.state.phase !== "planning") return;
    this.resolving = true;
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

    this.emptyPlanStreaks = advanceEmptyPlanStreaks(
      this.emptyPlanStreaks,
      planHasAnyMove(wm),
      planHasAnyMove(bm)
    );
    const dq = disqualificationWinner(this.emptyPlanStreaks);

    const ignoredCheckLoser = loserForIgnoredCheckIfAny(this.state.fen, wm, bm);
    if (ignoredCheckLoser) {
      this.endGame(ignoredCheckLoser === "white" ? "black" : "white", "ignored_check");
      return;
    }

    this.state.phase = "resolution";
    this.state.lastResolutionSteps.clear();

    const round = new RoundSnapshot();
    round.roundIndex = this.state.roundIndex;
    round.fenBefore = this.state.fen;
    round.whiteBidSlot = this.whiteBid ? this.whiteBid.slot : -1;
    round.whiteBidAmount = this.whiteBid?.amount ?? 0;
    round.blackBidSlot = this.blackBid ? this.blackBid.slot : -1;
    round.blackBidAmount = this.blackBid?.amount ?? 0;

    const resolved = resolvePlannedRound({
      fen: this.state.fen,
      roundIndex: this.state.roundIndex,
      slots: this.predictiveSlots,
      whiteMoves: wm,
      blackMoves: bm,
      whiteBid: this.whiteBid,
      blackBid: this.blackBid,
      whiteTokens: this.state.whiteTokens,
      blackTokens: this.state.blackTokens,
    });
    this.whiteBid = null;
    this.blackBid = null;
    this.state.whiteTokens = resolved.whiteTokens;
    this.state.blackTokens = resolved.blackTokens;
    round.whiteTokensAfter = resolved.whiteTokens;
    round.blackTokensAfter = resolved.blackTokens;
    appendResolvedSteps(this.state.lastResolutionSteps, round, resolved.steps);
    this.state.fen = resolved.fen;
    round.fenAfter = resolved.fen;
    this.state.resolvedRounds.push(round);
    this.state.historyLog.push(formatRoundHistoryLine(round));
    this.broadcast("round_resolved", serializeRoundResolvedPayload(round));
    this.broadcastStatus();

    if (resolved.winner) {
      this.endGame(resolved.winner, "king");
      return;
    }

    const chess = safeLoadChess(resolved.fen);
    if (!chess) {
      const byKings = kingCaptureWinner(resolved.fen, "w");
      this.endGame(byKings ?? "draw", byKings ? "king" : "draw");
      return;
    }
    if (chess.isCheckmate()) {
      const loser = chess.turn();
      this.endGame(loser === "w" ? "black" : "white", "checkmate");
      return;
    }
    if (chess.isDraw()) {
      this.endGame("draw", "draw");
      return;
    }

    if (dq) {
      this.endGame(dq, "empty_plan_dq");
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
    reason: "king" | "checkmate" | "draw" | "disconnect" | "resign" | "ignored_check" | "empty_plan_dq"
  ) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = undefined;
    this.state.phase = "finished";
    this.state.winner = winner;
    this.state.gameOverReason =
      reason === "ignored_check"
        ? "Sconfitta per mancata uscita dallo scacco"
        : reason === "empty_plan_dq"
          ? emptyPlanDqMessage(winner)
          : "";
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
