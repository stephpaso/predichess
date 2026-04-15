# ♟️ Predict Chess

**Predict Chess** è una variante tattica degli scacchi tradizionali basata sulla meccanica della **pianificazione anticipata**. Non è solo una sfida di logica scacchistica, ma un gioco di previsione psicologica in cui devi anticipare non solo le mosse dell'avversario, ma anche come queste invalideranno i tuoi piani.

---

## 🚀 Il Progetto: AI Agents & Vibe-Coding (Aprile 2026)

Questo progetto è nato **"for fun"** come esperimento tecnologico. L'obiettivo principale è testare e spingere al limite le capacità degli **agenti AI** nello stato in cui si trovano ad **Aprile 2026**.

È un esempio di sviluppo **"vibe-coded"**: l'architettura, la logica di gioco e l'interfaccia sono state iterate attraverso conversazioni di alto livello con agenti AI, trasformando "vibes" e concetti astratti in codice funzionale, scalabile e moderno in tempi record.

---

## 🕹️ Come si gioca?

Le regole si basano sugli scacchi classici, ma con un twist fondamentale:

1. **Fase di Pianificazione:** Entrambi i giocatori hanno un tempo limitato (default 20s) per programmare una sequenza di mosse (es. 3 o 5 mosse). Durante questa fase, vedi sulla scacchiera l'anteprima dei tuoi movimenti futuri.
2. **Fase di Risoluzione:** Una volta confermate le sequenze, il gioco esegue le mosse automaticamente.
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
- ⚡ **Resilienza:** Sistema di riconnessione automatica (fino a 3 minuti) per gestire cali di rete senza perdere la partita.

---

## 🛠️ Tech Stack

- **Frontend:** React + Vite + Tailwind CSS (Mobile-first).
- **Backend:** Node.js + TypeScript.
- **Real-time Engine:** [Colyseus](https://colyseus.io/) (State synchronization & Room management).
- **Logic:** `chess.js` per la validazione delle mosse.
- **Development:** Sviluppato interamente tramite **AI Agents**.

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

## 📝 Disclaimer

Questo software è un esperimento di programmazione assistita da intelligenza artificiale. È distribuito così com'è, creato per puro scopo di intrattenimento e ricerca sulle capacità degli agenti AI nel 2026.

---

*Creato con le vibes di Aprile 2026.* 🌀