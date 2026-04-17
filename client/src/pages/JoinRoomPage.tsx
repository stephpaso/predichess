import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAvailablePredictRooms } from "../lib/colyseus";

export function JoinRoomPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<
    Array<{
      roomId: string;
      clients: number;
      maxClients: number;
      code?: string;
      turnTimeSec?: number;
      predictiveSlots?: number;
      started?: boolean;
      isPublic?: boolean;
      gameMode?: string;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    async function fetchRooms() {
      try {
        const raw = await getAvailablePredictRooms();
        if (cancelled) return;
        const mapped = raw.map((r) => {
          const md = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            roomId: r.roomId,
            clients: r.clients,
            maxClients: r.maxClients,
            code: typeof md.code === "string" ? md.code : undefined,
            turnTimeSec: typeof md.turnTimeSec === "number" ? md.turnTimeSec : undefined,
            predictiveSlots: typeof md.predictiveSlots === "number" ? md.predictiveSlots : undefined,
            started: typeof md.started === "boolean" ? md.started : undefined,
            isPublic: typeof md.isPublic === "boolean" ? md.isPublic : undefined,
            gameMode: typeof md.gameMode === "string" ? md.gameMode : undefined,
          };
        });
        setRooms(mapped);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchRooms();
    const id = window.setInterval(fetchRooms, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const joinable = useMemo(() => {
    return rooms
      .filter((r) => (r.isPublic ?? true) === true)
      .filter((r) => (r.started ?? false) === false)
      .filter((r) => r.clients >= 1 && r.clients < 2)
      .slice(0, 12);
  }, [rooms]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) return;
    navigate(`/play/${c}`);
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <Link to="/multiplayer" className="mb-6 text-sm text-indigo-400">
        ← Indietro
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-white">Entra in stanza</h1>

      <div className="mb-6 rounded-2xl border border-white/10 bg-slate-950 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Stanze pubbliche</h2>
          <span className="text-[11px] text-slate-500">
            {loading ? "Live…" : `${joinable.length} disponibili`}
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 text-slate-400">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2 text-right">Opzioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 bg-slate-950">
              {joinable.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-slate-500" colSpan={2}>
                    Nessuna stanza pronta. Crea tu una stanza pubblica!
                  </td>
                </tr>
              )}
              {joinable.map((r) => {
                const code = (r.code ?? r.roomId).toUpperCase();
                const tt = r.turnTimeSec ?? 20;
                const slots = r.predictiveSlots ?? 3;
                const modeLabel = r.gameMode === "shuffle" ? "Shuffle" : "Classico";
                return (
                  <tr key={r.roomId} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/play/${code}`)}
                        className="font-mono text-slate-200 hover:text-white"
                      >
                        {code}
                      </button>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {r.clients}/2 giocatori
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-slate-400">
                      {modeLabel} · {tt}s · {slots} slot
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm text-slate-400">
          Codice privato
          <input
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-3 font-mono text-lg uppercase tracking-widest text-white outline-none ring-indigo-500 focus:ring-2"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCDE"
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect="off"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-indigo-600 py-3 font-medium text-white"
        >
          Entra
        </button>
      </form>
    </div>
  );
}
