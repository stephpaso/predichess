import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createMatchRoom,
  PREDICT_ROOM_ID_KEY,
  type GameModeOption,
  type MatchRoomOptions,
} from "../lib/colyseus";

const RES_KEY_PREFIX = "predichess:reservation:";

export function CreateRoomPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [hostColorPref, setHostColorPref] = useState<MatchRoomOptions["hostColorPref"]>("random");
  const [gameMode, setGameMode] = useState<GameModeOption>("classic");
  const [turnTimeSec, setTurnTimeSec] = useState<number>(20);
  const [predictiveSlots, setPredictiveSlots] = useState<number>(3);
  const [isPublic, setIsPublic] = useState<boolean>(true);

  const normalized = useMemo(() => {
    const t = Math.max(10, Math.min(60, Math.floor(Number(turnTimeSec) || 0)));
    const s = Math.max(1, Math.min(5, Math.floor(Number(predictiveSlots) || 0)));
    return { t, s };
  }, [turnTimeSec, predictiveSlots]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { roomCode: code, reservation } = await createMatchRoom({
        hostColorPref,
        turnTimeSec: normalized.t,
        predictiveSlots: normalized.s,
        isPublic,
        mode: gameMode,
      });
      // Store host seat reservation so the first tab consumes it (avoids phantom reserved seat → "locked").
      try {
        sessionStorage.setItem(`${RES_KEY_PREFIX}${code}`, JSON.stringify(reservation));
        sessionStorage.setItem(PREDICT_ROOM_ID_KEY, code);
      } catch {
        // ignore storage errors; fallback to normal join
      }
      navigate(`/room/${code}`, { replace: true });
    } catch {
      setError("Impossibile creare la stanza. Riprova.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <Link to="/multiplayer" className="mb-6 text-sm text-indigo-400">
        ← Indietro
      </Link>
      <h1 className="mb-2 text-2xl font-semibold text-white">Opzioni partita</h1>
      <p className="mb-6 text-sm text-slate-400">
        Configura la stanza prima di crearla.
      </p>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
                onClick={() => setHostColorPref(o.id)}
                className={`rounded-xl border px-3 py-3 text-sm ${
                  hostColorPref === o.id
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
            <label className="text-sm text-slate-300">Tempo turno</label>
            <span className="font-mono text-sm text-amber-300">{normalized.t}s</span>
          </div>
          <input
            type="range"
            min={10}
            max={60}
            value={turnTimeSec}
            onChange={(e) => setTurnTimeSec(Number(e.target.value))}
            className="mt-3 w-full accent-indigo-500"
          />
          <p className="mt-2 text-[11px] text-slate-500">Range 10–60 secondi.</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">Mosse predittive</label>
            <span className="font-mono text-sm text-amber-300">{normalized.s}</span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            value={predictiveSlots}
            onChange={(e) => setPredictiveSlots(Number(e.target.value))}
            className="mt-3 w-full accent-indigo-500"
          />
          <p className="mt-2 text-[11px] text-slate-500">Slot per round (1–5).</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-300">Visibilità</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Pubblica: appare nella lista stanze.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              className={`rounded-full border px-4 py-2 text-xs ${
                isPublic
                  ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
                  : "border-rose-500/40 bg-rose-950/40 text-rose-200"
              }`}
            >
              {isPublic ? "Pubblica" : "Privata"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={creating}
          className="rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg shadow-indigo-900/40 ring-1 ring-white/10 transition hover:bg-indigo-500 active:scale-[0.99] disabled:opacity-50"
        >
          {creating ? "Creazione…" : "Crea stanza"}
        </button>
      </form>
    </div>
  );
}
