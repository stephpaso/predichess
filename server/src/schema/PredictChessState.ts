import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") color: string = ""; // "white" | "black"
  @type("boolean") connected: boolean = true;
}

export class PlannedMove extends Schema {
  @type("string") from: string = "";
  @type("string") to: string = "";
}

export class StepSnapshot extends Schema {
  @type("string") fenAfter: string = "";
  /** FEN after White's half-move in this step; empty if White passed or unchanged. */
  @type("string") fenAfterWhite: string = "";
  @type("string") whiteMove: string = ""; // "e2e4" (from+to) or ""
  @type("string") blackMove: string = "";
  @type("boolean") whiteApplied: boolean = false;
  @type("boolean") blackApplied: boolean = false;
  @type("boolean") collision: boolean = false;
  @type(["string"]) captures = new ArraySchema<string>(); // e.g. ["b:p@e4"]
  /** "white" | "black" — who moved first in this step. */
  @type("string") firstMover: string = "";
  /** FEN after the first half-move (priority order). */
  @type("string") fenAfterFirst: string = "";
  /** Bid revealed for THIS slot only (0 = no bid on the slot). */
  @type("number") whiteBidAmount: number = 0;
  @type("number") blackBidAmount: number = 0;
}

export class RoundSnapshot extends Schema {
  @type("number") roundIndex: number = 0;
  @type("string") fenBefore: string = "";
  @type("string") fenAfter: string = "";
  @type([StepSnapshot]) steps = new ArraySchema<StepSnapshot>();
  /** Revealed after resolution. -1 = no bid. */
  @type("number") whiteBidSlot: number = -1;
  @type("number") whiteBidAmount: number = 0;
  @type("number") blackBidSlot: number = -1;
  @type("number") blackBidAmount: number = 0;
  @type("number") whiteTokensAfter: number = 0;
  @type("number") blackTokensAfter: number = 0;
}

export class PredictChessState extends Schema {
  @type("string") phase: string = "lobby"; // lobby | playing | planning | resolution | finished
  @type("string") fen: string = "";
  @type("string") currentTurn: string = "white";
  @type("string") planningSide: string = "white";
  @type("number") timerMs: number = 0;
  @type("number") roundIndex: number = 0;

  // Room options (set on create)
  @type("number") turnTimeMs: number = 45_000;
  @type("number") predictiveSlots: number = 2; // 2-5
  @type("boolean") isPublic: boolean = true;
  @type("string") hostColorPref: string = "random"; // white | black | random
  /** "classic" | "shuffle" — shuffle starts from a random balanced midgame FEN. */
  @type("string") gameMode: string = "classic";

  @type({ map: Player }) players = new MapSchema<Player>();

  @type("string") winner: string = "";
  /** Human-readable end reason (e.g. anti-stall check rule). */
  @type("string") gameOverReason: string = "";

  @type([PlannedMove])
  whiteMoves = new ArraySchema<PlannedMove>();

  @type([PlannedMove])
  blackMoves = new ArraySchema<PlannedMove>();

  @type("boolean") whiteLocked: boolean = false;
  @type("boolean") blackLocked: boolean = false;

  @type([StepSnapshot]) lastResolutionSteps = new ArraySchema<StepSnapshot>();

  @type([RoundSnapshot]) resolvedRounds = new ArraySchema<RoundSnapshot>();

  /** Human-readable log lines, one per resolved round (and intra-round game end if any). */
  @type(["string"]) historyLog = new ArraySchema<string>();

  /** Public token balances. Bids are NOT stored here — they stay server-side until resolution. */
  @type("number") whiteTokens: number = 3;
  @type("number") blackTokens: number = 3;
}
