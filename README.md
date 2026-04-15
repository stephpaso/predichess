# ♟️ Predict Chess

**Predict Chess** è una variante tattica degli scacchi tradizionali basata sulla meccanica della **pianificazione anticipata**. Non è solo una sfida di logica scacchistica, ma un gioco di previsione psicologica in cui devi anticipare non solo le mosse dell'avversario, ma anche come queste invalideranno i tuoi piani.

---

## 🚀 Il Progetto: Sviluppo 100% Autonomo (Aprile 2026)

Questo progetto è nato **"for fun"** come esperimento tecnologico radicale. L'obiettivo principale è testare e spingere al limite le capacità degli **agenti AI** nello stato in cui si trovano ad **Aprile 2026**.

L'intero ciclo di vita di questo software è stato gestito al **100% in modo autonomo da intelligenze artificiali**:

- **Progettazione:** Definizione del game design, regole e architettura client-server.
- **Sviluppo:** Scrittura del codice, setup del monorepo, implementazione del multiplayer in tempo reale e della UI.
- **Testing:** Creazione ed esecuzione di script di test per il debug autonomo della logica di validazione.

È un esempio estremo di sviluppo **"vibe-coded"**: l'umano ha fornito solo direttive concettuali ad alto livello, mentre l'AI ha tradotto le "vibes" in codice funzionale e moderno in tempi record.

---

## 🕹️ Come si gioca?

Le regole si basano sugli scacchi classici, ma con un twist fondamentale:

1. **Fase di Pianificazione:** Entrambi i giocatori hanno un tempo limitato (default 20s) per programmare una sequenza di mosse (es. 3 o 5 mosse). Durante questa fase, vedi sulla scacchiera l'anteprima dei tuoi movimenti futuri.
2. **Fase di Risoluzione:** Una volta confermate le sequenze (o allo scadere del tempo), il gioco esegue le mosse automaticamente.
3. **Priorità e Validità:** Le mosse vengono eseguite una alla volta, partendo dal **Bianco**.
  - Se l'avversario occupa una casella o blocca una traiettoria durante il suo micro-turno, la tua mossa programmata potrebbe diventare **illegale**.
    - In caso di mossa illegale, il pezzo rimane fermo e lo slot viene saltato.
4. **Vittoria:** Cattura il Re avversario o portalo allo scacco matto durante la risoluzione.

---

## ✨ Funzionalità Principali

- 🏠 **Home Dinamica:** Grafica curata con statistiche in tempo reale (utenti online e stanze attive).
- 🤝 **Matchmaking Avanzato:** * **Stanze Pubbliche:** Sfoglia la lista delle partite aperte e unisciti con un click.
  - **Stanze Private:** Crea la tua stanza e invita un amico tramite codice o link diretto.
- ⚙️ **Opzioni di Gioco Personalizzate:** Scegli il colore, il tempo per turno e il numero di mosse predittive per ogni round.
- 📊 **Storico e UX:** Navigazione tra i turni passati, visualizzazione dei pezzi catturati e timeline interattiva.
- ⚡ **Resilienza:** Sistema di riconnessione automatica per gestire cali di rete senza perdere la partita.

---

## 🛠️ Tech Stack

- **Frontend:** React + Vite + Tailwind CSS (Mobile-first).
- **Backend:** Node.js + TypeScript.
- **Real-time Engine:** [Colyseus](https://colyseus.io/) (State synchronization & Room management).
- **Logic:** `chess.js` per la validazione delle mosse.
- **Development:** Agenti AI (Cursor / LLMs).

---

## 🛠️ Installazione e Sviluppo

### Prerequisiti

- Node.js (versione 20+)
- npm o yarn

### Setup Locale

1. **Clona la repository:**
  ```bash
    git clone https://github.com/tuo-username/predict-chess.git
    cd predict-chess
  ```
2. **Installa le dipendenze (Monorepo):**
  ```bash
    npm install
  ```
3. **Avvia il Server:**
  ```bash
    cd server
    npm run start
  ```
4. **Avvia il Client:**
  ```bash
    cd client
    npm run dev
  ```

---

## ⚠️ Disclaimer e Sicurezza

Questo software è una *Proof of Concept* generata da intelligenza artificiale per puro scopo ludico e di ricerca. 

**Il codice sorgente NON ha subito verifiche manuali di sicurezza (security audits) e non è in alcun modo idoneo all'utilizzo in ambienti di produzione.** Potrebbero essere presenti vulnerabilità logiche, falle nella gestione dello stato multiplayer o debolezze infrastrutturali.

Prima di valutare un qualsiasi deploy pubblico o commerciale, il codice deve essere preso in carico, analizzato riga per riga, refattorizzato e adeguatamente protetto da sviluppatori e professionisti della sicurezza informatica. Utilizzalo a tuo rischio e pericolo.

---

*Creato con le vibes di Aprile 2026.* 🌀