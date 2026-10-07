type Props = {
  open: boolean;
  onClose: () => void;
};

const CORE_RULES: { title: string; body: string }[] = [
  {
    title: "Pianificazione",
    body: "Si programma una sequenza di N mosse. L'avversario non vede il piano finché il round non si risolve.",
  },
  {
    title: "Gettoni Iniziativa",
    body: "Si parte con 3 gettoni a testa. A ogni nuovo round di pianificazione, dopo il primo, +1 gettone fino a un massimo di 4. I saldi sono pubblici. Puoi offrire gettoni su un solo slot: l'offerta resta nascosta fino alla risoluzione.",
  },
  {
    title: "Priorità",
    body: "In ogni step muove per primo chi ha l'unica offerta, oppure chi ha offerto di più. A parità spende chi resta con meno gettoni. Senza offerte si alterna: il Bianco è primo solo se (round + step) è pari, altrimenti il Nero. Non si annullano mai entrambe le mosse.",
  },
  {
    title: "Catture",
    body: "La mossa del secondo viene controllata dopo quella del primo. Se diventa illegale, viene saltata. Catturare il Re chiude la partita: se entrambi lo catturerebbero nello stesso step, vince chi ha la priorità.",
  },
  {
    title: "Ricattura Anticipata",
    body: "È consentito pianificare mosse su case occupate da propri pezzi (non dal proprio Re), prevedendo che si libereranno.",
  },
  {
    title: "Scacco Vibe",
    body: "Se sei sotto scacco, DEVI pianificare almeno una mossa che teoricamente ti liberi. Se ignori lo scacco, perdi all'istante. Se provi a liberarti ma l'avversario ti blocca di nuovo, il gioco prosegue.",
  },
];

export function RulesModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 px-4 pb-8 pt-10 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(85dvh,32rem)] w-full max-w-md flex-col rounded-3xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id="rules-modal-title" className="text-base font-semibold text-white">
            Regolamento
          </h2>
          <button
            type="button"
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-slate-800"
            onClick={onClose}
          >
            Chiudi
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4 scrollbar-slate">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
            Regole Core
          </p>
          <ul className="space-y-3 text-sm text-slate-300">
            {CORE_RULES.map((rule) => (
              <li
                key={rule.title}
                className="rounded-2xl border border-white/10 bg-slate-900/40 p-3"
              >
                <span className="font-semibold text-slate-100">{rule.title}</span>
                <p className="mt-1.5 leading-relaxed text-slate-400">{rule.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
