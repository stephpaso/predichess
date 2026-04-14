import { Schema, type, MapSchema, ArraySchema, filter } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") color: string = "";
  @type("boolean") connected: boolean = true;
}

export class PlannedMove extends Schema {
  @type("string") from: string = "";
  @type("string") to: string = "";
}

export class StepSnapshot extends Schema {
  @type("string") fenAfter: string = "";
}

export class PredictChessState extends Schema {
  @type("string") phase: string = "lobby";
  @type("string") fen: string = "";
  @type("string") currentTurn: string = "white";
  @type("string") planningSide: string = "white";
  @type("number") timerMs: number = 0;
  @type("number") roundIndex: number = 0;

  @type({ map: Player }) players = new MapSchema<Player>();

  @type("string") winner: string = "";

  @filter(function (this: PredictChessState, client: { sessionId: string }) {
    const me = this.players.get(client.sessionId);
    return me?.color === "white";
  })
  @type([PlannedMove])
  whiteMoves = new ArraySchema<PlannedMove>();

  @filter(function (this: PredictChessState, client: { sessionId: string }) {
    const me = this.players.get(client.sessionId);
    return me?.color === "black";
  })
  @type([PlannedMove])
  blackMoves = new ArraySchema<PlannedMove>();

  @type("boolean") whiteLocked: boolean = false;
  @type("boolean") blackLocked: boolean = false;

  @type([StepSnapshot]) lastResolutionSteps = new ArraySchema<StepSnapshot>();
}
