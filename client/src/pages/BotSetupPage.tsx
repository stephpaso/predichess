import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createBotRoom, type GameModeOption } from "../lib/colyseus";

const RES_KEY_PREFIX = "predichess:reservation:";

type Difficulty = {
  id: "novice" | "amateur" | "advanced" | "master";
  label: string;
  elo: number;
  subtitle: string;
  glyph: string;
  accent: string;
};

const DIFFICULTIES: Difficulty[] = [
  {
    id: "novice",
    label: "Novellino",
    elo: 400,
    subtitle: "Fa mosse casuali.",
    glyph: "♟",
    accent: "border-slate-600/40 bg-slate-950",
  },
  {
    id: "amateur",
    label: "Dilettante",
    elo: 1000,
    subtitle: "Cerca di mangiare i pezzi.",
    glyph: "♞",
    accent: "border-emerald-500/30 bg-emerald-950/10",
  },
  {
    id: "advanced",
    label: "Avanzato",
    elo: 1800,
    subtitle: "Protegge i suoi pezzi.",
    glyph: "♝",
    accent: "border-indigo-500/30 bg-indigo-950/10",
  },
  {
    id: "master",
    label: "Maestro AI",
    elo: 2500,
    subtitle: "Non perdona.",
    glyph: "♛",
    accent: "border-amber-500/30 bg-amber-950/10",
  },
];

export function BotSetupPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [difficulty, setDifficulty] = useState<Difficulty>(DIFFICULTIES[1]);
  const [color, setColor] = useState<"white" | "black" | "random">("random");
  const [gameMode, setGameMode] = useState<GameModeOption>("classic");
  const [predictiveMoves, setPredictiveMoves] = useState<number>(3);

  const normalized = useMemo(() => {
    const s = Math.max(1, Math.min(5, Math.floor(Number(predictiveMoves) || 0)));
    return { s };
  }, [predictiveMoves]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { roomId, roomCode: code, reservation } = await createBotRoom({
        botElo: difficulty.elo,
        color,
        predictiveMoves: normalized.s,
        mode: gameMode,
      });
      try {
        sessionStorage.setItem(`${RES_KEY_PREFIX}${code}`, JSON.stringify(reservation));
      } catch {
        // ignore
      }
      // also include resolved roomId as fallback if storage is unavailable
      navigate(`/play/${code}?rid=${encodeURIComponent(roomId)}`, {
        replace: true,
      });
    } catch {
      setError("Impossibile creare la partita contro bot. Riprova.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <Link to="/" className="mb-6 text-sm text-indigo-400">
        ← Indietro
      </Link>
      <h1 className="mb-2 text-2xl font-semibold text-white">Gioca contro Bot</h1>
      <p className="mb-6 text-sm text-slate-400">
        Seleziona difficoltà e opzioni. La stanza viene creata subito.
      </p>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm text-slate-300">Difficoltà (ELO)</label>
            <span className="font-mono text-sm text-amber-300">{difficulty.elo}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DIFFICULTIES.map((d) => {
              const active = d.id === difficulty.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  className={`rounded-2xl border px-3 py-3 text-left transition active:scale-[0.99] ${
                    active
                      ? "border-indigo-500/60 bg-indigo-950/40"
                      : `border-white/10 bg-slate-900 hover:bg-slate-800`
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-50">{d.label}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{d.subtitle}</div>
                    </div>
                    <div
                      className={`grid h-10 w-10 place-items-center rounded-xl border text-lg text-slate-100 ${d.accent}`}
                      aria-hidden="true"
                    >
                      {d.glyph}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <label className="text-sm text-slate-300">Modalità di gioco</label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                { id: "classic" as const, label: "Classico", hint: "Posizione iniziale" },
                { id: "shuffle" as const, label: "Shuffle", hint: "Mediogioco casuale" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setGameMode(o.id)}
                className={`rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] ${
                  gameMode === o.id
                    ? "border-indigo-500 bg-indigo-950/50 text-slate-50"
                    : "border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                <div className="text-sm font-medium">{o.label}</div>
                <div className="mt-1 text-[11px] text-slate-500">{o.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <label className="text-sm text-slate-300">Colore</label>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                { id: "white", label: "Bianco" },
                { id: "black", label: "Nero" },
                { id: "random", label: "Casuale" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setColor(o.id)}
                className={`rounded-xl border px-3 py-3 text-sm ${
                  color === o.id
                    ? "border-indigo-500 bg-indigo-950/50 text-slate-50"
                    : "border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">Mosse predittive</label>
            <span className="font-mono text-sm text-amber-300">{normalized.s}</span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPredictiveMoves(n)}
                className={`rounded-xl border py-2 text-sm ${
                  normalized.s === n
                    ? "border-indigo-500 bg-indigo-950/50 text-slate-50"
                    : "border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Selezione discreta (snap), stile Chess.com.
          </p>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg shadow-indigo-900/40 ring-1 ring-white/10 transition hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50"
        >
          {creating ? "Creazione…" : "Inizia"}
        </button>
      </form>
    </div>
  );
}

