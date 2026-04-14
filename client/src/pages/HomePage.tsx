import { Link } from "react-router-dom";

type Props = {
  onBot: () => void;
};

export function HomePage({ onBot }: Props) {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-white">Predict Chess</h1>
        <p className="mt-2 text-sm text-slate-400">
          Mosse programmate, risoluzione simultanea
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-3">
        <button
          type="button"
          onClick={onBot}
          className="rounded-xl bg-slate-800 px-4 py-4 text-base font-medium text-white ring-1 ring-white/10 active:bg-slate-700"
        >
          Gioca contro Bot
        </button>

        <Link
          to="/multiplayer"
          className="rounded-xl bg-indigo-600 px-4 py-4 text-center text-base font-medium text-white shadow-lg shadow-indigo-900/40 ring-1 ring-white/10 active:bg-indigo-500"
        >
          Gioca Multiplayer
        </Link>
      </div>
    </div>
  );
}
