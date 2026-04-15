Regolamento Ufficiale: Predict Chess

1. Scopo del Gioco e Preparazione

L'obiettivo è eliminare il Re avversario o portarlo in una posizione in cui la sua cattura è inevitabile (Scacco Matto).

```
La Scacchiera: Il gioco si svolge su una griglia ridotta (ad esempio 5x5 o 6x6).

Disposizione Iniziale: I pezzi vengono generati casualmente all'inizio di ogni partita. La disposizione è simmetrica e garantisce sempre che ci sia materiale sufficiente per arrivare allo scacco matto.

Movimento: I pezzi si muovono seguendo le regole classiche degli scacchi.
```

1. Fase di Pianificazione (Il Turno)

A differenza degli scacchi tradizionali, il gioco si svolge in round simultanei.

```
La Sequenza: All'inizio di ogni round, entrambi i giocatori devono programmare una sequenza esatta di 5 mosse.

Il Timer: I giocatori hanno un limite di tempo rigoroso di 20 secondi per completare la loro sequenza.

Conferma: Una volta scelte le 5 mosse, il giocatore preme "Conferma". Se il timer scade prima della conferma, le mosse inserite fino a quel momento vengono bloccate. Eventuali slot vuoti nella sequenza (es. ne sono state inserite solo 3 su 5) verranno considerati come "Passa il turno" per quegli specifici step. I giocatori non vedono le mosse dell'avversario durante questa fase.
```

1. Fase di Risoluzione (Esecuzione)

Una volta che entrambi i giocatori hanno confermato (o il timer è scaduto), la scacchiera esegue le mosse simultaneamente, step by step (Mossa 1 contro Mossa 1, Mossa 2 contro Mossa 2, ecc.).

Durante l'esecuzione, lo stato della scacchiera cambia costantemente, introducendo le seguenti regole di risoluzione:

```
La Mossa Irregolare (Azione Annullata): Se, al momento dell'esecuzione, la mossa programmata da un giocatore risulta impossibile a causa dei cambiamenti avvenuti sulla scacchiera negli step precedenti, la mossa non viene effettuata. Il pezzo rimane fermo.

Esempio: Avevi programmato di muovere l'Alfiere in C4 allo step 3. Allo step 2, l'avversario ha posizionato un suo pezzo sulla traiettoria, bloccandola. Allo step 3, la tua mossa è invalida e il tuo Alfiere non si muove.

Il Divieto di Suicidio: Se una mossa mette il proprio Re sotto scacco (o non risolve uno scacco preesistente), è considerata irregolare e viene annullata.
```

1. Gestione dei Conflitti e Catture

Le catture avvengono normalmente quando un pezzo atterra sulla casella occupata da un pezzo avversario già fermo. Tuttavia, la natura simultanea del gioco introduce una regola speciale:

```
Distruzione Reciproca (Collisione Frontale): Se nello stesso identico step entrambi i giocatori muovono un proprio pezzo sulla stessa casella di destinazione, ed entrambi avrebbero il diritto di catturarsi a vicenda secondo le regole di movimento, avviene uno scontro simultaneo. Entrambi i pezzi vengono distrutti e rimossi dalla scacchiera.

Ecezione (Scontro tra Re): Se i due Re si muovono simultaneamente sulla stessa casella, la mossa è considerata irregolare per entrambi (poiché si metterebbero reciprocamente sotto scacco) e viene annullata. I Re rimangono nelle loro posizioni di partenza di quello step.
```

1. Fine della Partita

La partita termina immediatamente durante la Fase di Risoluzione non appena si verifica una delle seguenti condizioni:

```
Scacco Matto / Cattura del Re: Se un Re viene catturato (poiché il giocatore non aveva previsto la minaccia e non l'ha spostato o difeso) o viene messo in una posizione di scacco matto classico al termine della sequenza.

Stallo (Pareggio): Se al termine dei 5 step nessuno dei giocatori ha mosse legali a disposizione, o se rimangono solo i due Re sulla scacchiera.
```

