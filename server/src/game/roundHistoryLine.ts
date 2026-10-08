import type { RoundSnapshot } from "../schema/PredictChessState.js";

export function formatRoundHistoryLine(round: RoundSnapshot): string {
  const steps = round.steps.toArray();
  const parts = steps.map((s, i) => {
    const w = s.whiteMove
      ? `Bianco ${s.whiteMove.slice(0, 2)}→${s.whiteMove.slice(2)}${s.whiteApplied ? "" : " (respinta)"}`
      : "Bianco —";
    const b = s.blackMove
      ? `Nero ${s.blackMove.slice(0, 2)}→${s.blackMove.slice(2)}${s.blackApplied ? "" : " (respinta)"}`
      : "Nero —";
    const who = s.firstMover === "black" ? "Nero" : "Bianco";
    const wb = s.whiteBidAmount ?? 0;
    const bb = s.blackBidAmount ?? 0;
    const prio =
      wb <= 0 && bb <= 0
        ? `priorità ${who} (nessuna offerta → alternanza)`
        : `priorità ${who} (offerte Bianco ${wb}, Nero ${bb})`;
    let seg = `S${i + 1}: ${w}, ${b} | ${prio}`;
    if (s.collision) seg += " | collisione";
    const caps = s.captures?.toArray?.() ?? [];
    if (caps.length) seg += ` | ${caps.join(", ")}`;
    return seg;
  });
  return `Round ${round.roundIndex + 1}: ${parts.join(" · ")}`;
}
