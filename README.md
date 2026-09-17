# Invoice to FIC

Dashboard Next.js per estrazione e revisione di fatture PDF SaaS, collegamento OAuth e registrazione manualmente confermata delle spese in Fatture in Cloud.

## Avvio

Configurare `.env.local` usando i nomi in `.env.example`, poi eseguire `npm install` e `npm run dev`. Non committare credenziali o PDF. `npm test`, `npm run lint`, `npm run typecheck` e `npm run build` verificano il progetto.

## Registrazione spese

1. Autorizzare FIC con `entity.suppliers:r received_documents:a`. Le precedenti sessioni in sola lettura richiedono un nuovo consenso tramite "Autorizza spese".
2. Selezionare l'azienda, caricare i PDF, correggere e approvare i dati.
3. Per una fattura approvata in EUR, scegliere "Prepara spesa".
4. Il fornitore gia presente in FIC viene preselezionato solo se esiste un unico VAT corrispondente. Per i fornitori SaaS supportati viene proposto, su richiesta dell'utente, il profilo modificabile 100% deducibilita costo / 100% detraibilita IVA. Non e una verifica del diritto fiscale del contribuente. Controllare la scadenza, inizialmente proposta dalla data fattura.
5. Le percentuali sono modificabili in "Impostazioni fiscali del fornitore". "Salva impostazioni" conserva solo le preferenze nel browser, separate per azienda e fornitore FIC; le preferenze salvate prevalgono sui valori proposti. PDF, fatture e bozze restano esclusivamente in memoria. Un altro browser o la cancellazione dei dati locali richiede una nuova configurazione.
6. "Controlla spesa" verifica anche i duplicati e mostra l'anteprima. "Conserva bozza" mantiene il lavoro nella pagina, senza registrare nulla in FIC. Le bozze con percentuali mancanti sono contrassegnate "Dati fiscali da confermare" e non ricevono un ticket di invio. Una modifica alla fattura annulla la bozza e l'approvazione.
7. Per registrare una spesa con dati completi, verificare l'anteprima, spuntare la conferma e premere "Conferma e crea spesa".

Per i fornitori SaaS riconosciuti senza IVA addebitata e senza VAT italiano viene visualizzato **TD17 proposto**, che resta da verificare e preparare separatamente. Non viene creato un documento TD17, non si applica automaticamente un'aliquota del 22% e non si invia nulla allo SDI. Nessuna proposta TD17 viene fatta per un fornitore sconosciuto o una fattura con IVA addebitata. GitHub non e ancora un parser supportato.

La spesa viene registrata con pagamento **non pagato** e contrassegnata in FIC. Il documento non e una bozza contabile: il comando finale crea una spesa reale. Eventuali pagamenti gia effettuati vanno aggiornati in FIC. Nessun PDF viene trasferito o salvato; l'allegato resta escluso da questa fase. Nessun invio SDI, reverse charge o TD17/TD18 viene effettuato. Queste operazioni restano un passaggio separato. Le valute diverse da EUR non sono ancora abilitate alla creazione.

## Controlli e limiti

- Validazione server di date, importi e quadratura; una modifica annulla l'approvazione.
- Anteprima firmata, legata alla sessione di login, azienda, fattura e impostazioni; validita dieci minuti.
- Controllo azienda e fornitore, confronto VAT quando presente e ricerca paginata dei duplicati prima dell'anteprima e immediatamente prima della scrittura.
- Conferma esplicita, controllo origine della richiesta, autenticazione e permessi di scrittura verificati sul server.
- Nessun retry automatico delle scritture: dopo una risposta incerta, controllare direttamente le Spese in FIC.
- Dati temporanei in memoria, senza database. Il blocco degli invii concorrenti e locale al processo: **non e un lock distribuito e non garantisce exactly-once tra istanze Vercel o dopo riavvii**. Usare un solo operatore e una sola scheda per gli invii. Prima di un uso multiutente serve un archivio condiviso delle operazioni con vincolo univoco e gestione degli esiti incerti.
- La verifica dei duplicati si interrompe senza scrivere se non riesce a completare l'elenco (massimo 100 pagine da 100 elementi).

I test usano risposte FIC simulate e non creano spese reali. La verifica reale OAuth e della prima registrazione avviene con consenso dell'utente nell'app.

Riferimenti: [API Received Documents](https://github.com/fattureincloud/fattureincloud-ts-sdk/blob/master/docs/ReceivedDocumentsApi.md), [modello ReceivedDocument](https://github.com/fattureincloud/fattureincloud-ts-sdk/blob/master/docs/ReceivedDocument.md).
