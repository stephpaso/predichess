import { Chess } from "chess.js";

/**
 * Mediogiochi bilanciati (~8–12 mosse), senza scacco al lato che muove.
 * Derivate da linee standard (Ruy Lopez, Italiana, QGD, Siciliana, Francese).
 */
export const MIDGAME_FENS: readonly string[] = [
  // Ruy Lopez — Berlin / Morphy dopo sviluppo cavallo
  "r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4",
  // Italiana — Giuoco Piano
  "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8",
  // Gambetto di Donna Rifiutato — struttura classica
  "rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 5",
  // Siciliana — struttura tipica con pedoni centrali
  "rnbqkb1r/1p2pppp/p2ppn2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 8",
  // Francese — variante con ...e6 e struttura centrale
  "rnbqkb1r/pp3ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 6",
];

export type GameMode = "classic" | "shuffle";

export function normalizeGameMode(raw: unknown): GameMode {
  return raw === "shuffle" ? "shuffle" : "classic";
}

export function pickRandomMidgameFen(rng: () => number = Math.random): string {
  const idx = Math.floor(rng() * MIDGAME_FENS.length);
  const fen = MIDGAME_FENS[idx] ?? MIDGAME_FENS[0]!;
  const chess = new Chess();
  chess.load(fen);
  return chess.fen();
}
