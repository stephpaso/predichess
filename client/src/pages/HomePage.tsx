import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiBase } from "../lib/colyseus";

type Props = {
  onBot: () => void;
};

export function HomePage({ onBot }: Props) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomParam = useMemo(() => {
    const raw = params.get("room") ?? "";
    const c = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    return c.length >= 4 ? c : "";
  }, [params]);
  const guest = useMemo(() => {
    return (params.get("guest") ?? "") === "1";
  }, [params]);

  const [howOpen, setHowOpen] = useState(false);
  const [stats, setStats] = useState<{ activeRooms: number; connectedUsers: number } | null>(null);

  useEffect(() => {
    if (!roomParam) return;
    if (guest) {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i) ?? "";
          if (k.toLowerCase().includes("colyseus")) localStorage.removeItem(k);
        }
      } catch {
        // ignore
      }
    }
    navigate(`/play/${roomParam}`, { replace: true });
  }, [roomParam, guest, navigate]);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await fetch(`${apiBase}/stats`);
        if (!res.ok) return;
        const data = (await res.json()) as { activeRooms?: number; connectedUsers?: number };
        if (cancelled) return;
        setStats({
          activeRooms: Number(data.activeRooms ?? 0) || 0,
          connectedUsers: Number(data.connectedUsers ?? 0) || 0,
        });
      } catch {
        // ignore
      }
    }
    void fetchStats();
    const id = window.setInterval(fetchStats, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-indigo-700/20 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-80 w-80 rounded-full bg-emerald-600/10 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900" />
      </div>

      <header className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-950 shadow-lg shadow-black/30">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M8 21h8m-9-3h10m-7-3 2-5-3-2 3-3-4-2 1 7-2 5"
              stroke="currentColor"
              className="text-indigo-300"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Predict Chess</h1>
        <p className="mt-2 text-sm text-slate-400">
          Pianifica mosse. Il server le risolve in sequenza.
        </p>

        <div className="mt-4 flex items-center justify-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950 px-3 py-1 text-slate-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
          <span className="rounded-full border border-white/10 bg-slate-950 px-3 py-1 text-slate-400">
            Stanze:{" "}
            <span className="font-mono text-slate-200">
              {stats ? stats.activeRooms : "—"}
            </span>
          </span>
          <span className="rounded-full border border-white/10 bg-slate-950 px-3 py-1 text-slate-400">
            Utenti:{" "}
            <span className="font-mono text-slate-200">
              {stats ? stats.connectedUsers : "—"}
            </span>
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3">
        <button
          type="button"
          onClick={onBot}
          className="rounded-2xl bg-slate-900 px-4 py-4 text-base font-medium text-white ring-1 ring-white/10 transition hover:bg-slate-800 active:scale-[0.99]"
        >
          Gioca contro Bot
        </button>

        <Link
          to="/multiplayer"
          className="rounded-2xl bg-indigo-600 px-4 py-4 text-center text-base font-medium text-white shadow-lg shadow-indigo-900/40 ring-1 ring-white/10 transition hover:bg-indigo-500 active:scale-[0.99]"
        >
          Gioca Multiplayer
        </Link>

        <button
          type="button"
          onClick={() => setHowOpen(true)}
          className="rounded-2xl border border-white/10 bg-slate-950 px-4 py-4 text-center text-sm font-medium text-slate-200 transition hover:bg-slate-900 active:scale-[0.99]"
        >
          Come si gioca
        </button>
      </div>

      {howOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-8 pt-10"
          role="dialog"
          aria-modal="true"
          onClick={() => setHowOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Come si gioca</h2>
              <button
                type="button"
                className="rounded-full bg-slate-900 px-3 py-1 text-xs text-slate-200"
                onClick={() => setHowOpen(false)}
              >
                Chiudi
              </button>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-slate-300">
              <li className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <span className="font-semibold text-slate-100">1) Pianificazione</span>
                <div className="mt-1 text-slate-400">
                  Inserisci fino a \(N\) mosse nello stesso round.
                </div>
              </li>
              <li className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <span className="font-semibold text-slate-100">2) Risoluzione sequenziale</span>
                <div className="mt-1 text-slate-400">
                  Il server applica gli step uno alla volta, creando un esito deterministico.
                </div>
              </li>
              <li className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <span className="font-semibold text-slate-100">3) Collisioni</span>
                <div className="mt-1 text-slate-400">
                  Se una mossa diventa illegale dopo uno step precedente, viene scartata.
                </div>
              </li>
              <li className="rounded-2xl border border-white/10 bg-slate-900/40 p-3">
                <span className="font-semibold text-slate-100">4) Scacco matto</span>
                <div className="mt-1 text-slate-400">
                  Vince chi mette l’altro re in scacco matto (o per cattura del re).
                </div>
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
