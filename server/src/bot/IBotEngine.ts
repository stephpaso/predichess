export type BotMoveUci = string;

/**
 * Strategy interface for bot engines.
 *
 * The room only depends on this contract, so we can swap the implementation
 * (Stockfish, neural engine, etc.) without touching Colyseus room logic.
 */
export interface IBotEngine {
  /**
   * Predict a sequence of moves for the side-to-move in `currentFen`.
   *
   * Returns UCI-like moves, e.g. "e2e4" or "e7e8q" (promotion suffix).
   */
  predictSequence(currentFen: string, numberOfMoves: number, elo: number): BotMoveUci[];
}

