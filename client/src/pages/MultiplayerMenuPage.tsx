import { Link } from "react-router-dom";

export function MultiplayerMenuPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <Link
        to="/"
        className="mb-6 text-sm text-indigo-400 hover:text-indigo-300"
      >
        ← Indietro
      </Link>
      <h1 className="mb-8 text-2xl font-semibold text-white">Multiplayer</h1>
      <div className="flex flex-col gap-3">
        <Link
          to="/multiplayer/create"
          className="rounded-xl bg-slate-800 px-4 py-4 text-center text-base font-medium text-white ring-1 ring-white/10"
        >
          Crea Stanza
        </Link>
        <Link
          to="/multiplayer/join"
          className="rounded-xl bg-slate-800 px-4 py-4 text-center text-base font-medium text-white ring-1 ring-white/10"
        >
          Entra in una Stanza
        </Link>
      </div>
    </div>
  );
}
