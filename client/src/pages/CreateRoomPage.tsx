import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createMatchRoom } from "../lib/colyseus";

export function CreateRoomPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { roomCode: code } = await createMatchRoom();
        if (!cancelled) {
          setRoomCode(code);
          navigate(`/play/${code}`, { replace: true });
        }
      } catch {
        if (!cancelled) setError("Impossibile creare la stanza. Riprova.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <Link to="/multiplayer" className="mb-6 text-sm text-indigo-400">
        ← Indietro
      </Link>
      <h1 className="mb-4 text-2xl font-semibold text-white">Crea stanza</h1>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && (
        <p className="text-slate-400">
          {roomCode ? (
            <>
              Codice: <span className="font-mono text-lg text-white">{roomCode}</span>
            </>
          ) : (
            "Creazione in corso…"
          )}
        </p>
      )}
    </div>
  );
}
