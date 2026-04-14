import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

export function JoinRoomPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

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
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm text-slate-400">
          Codice stanza
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
