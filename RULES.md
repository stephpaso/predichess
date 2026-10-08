Regolamento Ufficiale: Predict Chess

1. Scopo del Gioco e Preparazione

L'obiettivo è eliminare il Re avversario o portarlo in una posizione in cui la sua cattura è inevitabile (Scacco Matto).

```
La Scacchiera: Il gioco si svolge su una griglia ridotta (ad esempio 5x5 o 6x6).

Disposizione Iniziale: I pezzi vengono generati casualmente all'inizio di ogni partita. La disposizione è simmetrica e garantisce sempre che ci sia materiale sufficiente per arrivare allo scacco matto.

Movimento: I pezzi si muovono seguendo le regole classiche degli scacchi.
```

2. Fase di Pianificazione (Il Turno)

A differenza degli scacchi tradizionali, il gioco si svolge in round simultanei.

```
La Sequenza: All'inizio di ogni round entrambi i giocatori possono programmare fino a N mosse. N si sceglie a inizio partita, da 2 a 5 (default 2). Non è obbligatorio riempire ogni slot.

Il Timer: C'è un limite di tempo, di default 45 secondi. Il round di pianificazione si chiude quando entrambi premono Conferma, oppure allo scadere del tempo. Allo scadere restano bloccate le mosse già scelte e l'offerta di iniziativa impostata.

Conferma: Il giocatore preme "Conferma" per bloccare mosse e offerta. La sequenza non si blocca da sola quando gli slot sono pieni. Gli slot vuoti valgono come "Passa il turno" in quello step: si giocano solo le mosse scelte. Se una mossa diventa illegale in risoluzione, si salta solo quello slot; le mosse scelte negli slot successivi si tentano comunque. I giocatori non vedono le mosse dell'avversario durante questa fase.
```

3. Fase di Risoluzione (Esecuzione)

Una volta che entrambi i giocatori hanno confermato (o il timer è scaduto), la scacchiera esegue le mosse step by step (Mossa 1 contro Mossa 1, Mossa 2 contro Mossa 2, e così via).

In ogni step c'è sempre un primo giocatore e poi l'altro. Non esiste una risoluzione simultanea che annulli o distrugga entrambe le mosse. Chi muove per primo è deciso dai Gettoni Iniziativa. La mossa del secondo viene controllata sulla scacchiera già aggiornata dalla prima.

```
La Mossa Irregolare (Azione Annullata): Se, al momento dell'esecuzione, la mossa programmata da un giocatore risulta impossibile a causa dei cambiamenti avvenuti sulla scacchiera, quella mossa non viene effettuata. Il pezzo rimane fermo. Il resto del piano non si cancella: gli slot successivi con una mossa scelta vengono comunque tentati.

Esempio: Avevi programmato di muovere l'Alfiere in C4 allo step 3. Allo step 2 l'avversario ha posizionato un suo pezzo sulla traiettoria, bloccandola. Allo step 3 la tua mossa è invalida e il tuo Alfiere non si muove.

Il Divieto di Suicidio: Se una mossa mette il proprio Re sotto scacco (o non risolve uno scacco preesistente) mentre entrambi i Re sono ancora sulla scacchiera, è considerata irregolare e viene annullata.

Il proprio Re non si cancella: è illegale muovere un proprio pezzo sulla casella occupata dal proprio Re. Quella mossa non si applica e il Re resta dov'è.
```

4. Gestione dei Conflitti e Catture

Le catture avvengono quando un pezzo atterra sulla casella occupata da un pezzo avversario. L'ordine è sequenziale, secondo la priorità dello step: prima si applica la mossa di chi ha l'iniziativa, poi quella dell'altro se è ancora legale.

```
Se entrambi puntano alla stessa casella, o se la mossa del secondo non è più possibile dopo la prima, viene eseguita solo la mossa che resta legale. Non si distruggono entrambi i pezzi in automatico e non si annullano entrambe le mosse: c'è sempre un primo a muovere.

Cattura del Re: Dopo ogni mezza mossa si controlla se il Re avversario è stato preso. In quel caso la partita termina subito e vince chi ha catturato. Se nello stesso step entrambe le mosse catturerebbero il Re avversario, vince chi ha la priorità: la sua cattura si applica e la seconda mossa non viene eseguita. Se entrambi i Re risultassero assenti nello stesso step, vince comunque chi aveva la priorità in quello step.
```

5. Gettoni Iniziativa

I gettoni decidono chi muove per primo in uno step. I saldi sono pubblici. Le offerte restano nascoste fino alla risoluzione, poi vengono rivelate step per step.

```
Economia: ogni giocatore inizia con 3 gettoni. All'inizio di ogni nuovo round di pianificazione, dopo il primo, riceve +1 gettone, fino a un massimo di 4. Il refresh non supera mai il tetto.

Offerta: in un round si può puntare al massimo su un solo slot (da 0 a N-1), con un importo intero da 0 fino ai gettoni posseduti. Un importo 0 equivale a nessuna offerta. L'offerta si blocca insieme al piano, oppure allo scadere del timer con quanto era stato impostato.

Priorità nello step i del round r (entrambi gli indici partono da 0):

1. Se un solo giocatore ha offerto su quello slot con importo maggiore di 0, muove per primo e spende l'offerta.
2. Se entrambi hanno offerto sullo stesso slot, muove per primo chi ha offerto di più; entrambi spendono la propria offerta. A parità di importo, muove per primo chi ha meno gettoni rimasti DOPO la spesa. Se anche i saldi restano pari, vale l'alternanza qui sotto.
3. Se nessuno ha offerto su quello slot, alternanza: il Bianco muove per primo se e solo se (r + i) è pari; altrimenti muove per primo il Nero.

La spesa avviene una sola volta a inizio risoluzione, non per ogni step. C'è sempre un primo giocatore definito.
```

6. Fine della Partita

La partita termina immediatamente durante la Fase di Risoluzione non appena si verifica una delle seguenti condizioni:

```
Scacco Matto / Cattura del Re: Se un Re viene catturato (poiché il giocatore non aveva previsto la minaccia e non l'ha spostato o difeso) o viene messo in una posizione di scacco matto classico al termine della sequenza. La cattura del Re chiude la partita subito, nell'ordine di priorità dello step, senza errori e senza annullare la mossa di chi ha colpito per primo.

Scacco non parato: Se un giocatore inizia il round sotto scacco e nessuna delle mosse scelte lo fa uscire dallo scacco, perde subito. Gli slot vuoti non parano lo scacco.

Squalifica: Se un giocatore non programma alcuna mossa per due round di fila, perde. Quel round viene comunque risolto, quindi le mosse dell'avversario valgono. Se entrambi restano senza mosse per due round, la partita è patta. Contro il computer la squalifica vale per il giocatore umano.

Stallo (Pareggio): Se al termine degli step nessuno dei giocatori ha mosse legali a disposizione, o se rimangono solo i due Re sulla scacchiera.
```
