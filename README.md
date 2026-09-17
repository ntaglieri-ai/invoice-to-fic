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

Per i fornitori SaaS riconosciuti senza IVA addebitata e senza VAT italiano viene visualizzato **TD17 proposto**, da preparare con il flusso separato descritto sotto. Nessuna proposta TD17 viene fatta per un fornitore sconosciuto o una fattura con IVA addebitata. GitHub non e ancora un parser supportato.

La spesa viene registrata con pagamento **non pagato**, centro WEB e contrassegnata in FIC. Il documento non e una bozza contabile: il comando finale crea una spesa reale. Eventuali pagamenti gia effettuati vanno aggiornati in FIC. Nessun PDF viene trasferito o salvato; l'allegato resta escluso da questa fase. Le valute diverse da EUR non sono ancora abilitate alla creazione.

## TD17 non inviato

1. Premere **Autorizza TD17**: richiede `issued_documents.self_invoices:a` in aggiunta a `entity.suppliers:r received_documents:a`. I token gia emessi non acquisiscono nuovi scope con il refresh.
2. Caricare e approvare la fattura. Se la spesa e gia in FIC, non registrarla di nuovo: **Prepara TD17** la ritrova confrontando fornitore, numero, data, valuta e importi. Funziona anche dopo il ricaricamento del PDF in una nuova sessione.
3. Controllare data TD17, aliquota e fornitore. L'aliquota del 22% viene proposta solo se univoca e abilitata in FIC; rimane modificabile. La data proposta e quella della fattura, da confermare secondo ricezione/operazione. Sezionale proposto `/TD17`, progressivo assegnato da FIC. Metodo pagamento predefinito FIC (in assenza, MP08 carta), modificabile. Regime fornitore RF01 proposto per questo flusso SaaS.
4. **Controlla TD17** legge l'anagrafica completa, verifica la spesa originale e i TD17 esistenti, calcola i totali tramite FIC e restituisce un'anteprima firmata. Non crea documenti.
5. Spuntare la conferma e premere **Salva TD17 non inviato**. Si crea un documento reale `self_supplier_invoice`, elettronico, con `TipoDocumento=TD17`, riferimento completo in `DatiFattureCollegate`, IVA integrata, centro WEB e pagamento `reversed` (Stornato), come nel flusso FIC. Non modifica il pagamento o l'IVA della spesa originale e non crea una seconda spesa.
6. L'app esegue la verifica formale XML. Anche se la verifica fallisce, mantiene l'ID del documento salvato: correggere il documento in FIC, senza ricrearlo. Aprire **Fatture e Documenti > Autofatture** in FIC, controllare e usare li **Firma e invia**. Non esiste un endpoint di invio nell'app e il client FIC blocca `/e_invoice/send`.

Limiti TD17: solo servizi dei fornitori supportati, EUR, imponibile positivo, IVA fornitore zero, VAT/Tax ID estero coincidente e indirizzo completo in FIC. Numeri fattura oltre 20 caratteri sono bloccati, mai troncati, per il limite del riferimento XML. Anagrafiche fiscali particolari, esenzioni, beni/TD18, valute estere e note di credito richiedono gestione separata. Il controllo XML non certifica la correttezza fiscale. Le impostazioni vanno confermate per il caso concreto.

La ricerca duplicati usa un riferimento deterministico salvato nel documento e gli estremi originali dei TD17 manuali. Un TD17 gia inviato viene mostrato come esistente, senza riscriverlo. Documenti manuali senza riferimenti originali non sono riconoscibili con certezza. Valgono i limiti di concorrenza riportati sotto: un solo operatore e una sola scheda.

## Controlli e limiti

- Validazione server di date, importi e quadratura; una modifica annulla l'approvazione.
- Anteprima firmata, legata alla sessione di login, azienda, fattura e impostazioni; validita dieci minuti.
- Controllo azienda e fornitore, confronto VAT quando presente e ricerca paginata dei duplicati prima dell'anteprima e immediatamente prima della scrittura.
- Conferma esplicita, controllo origine della richiesta, autenticazione e permessi di scrittura verificati sul server.
- Nessun retry automatico delle scritture: dopo una risposta incerta, controllare direttamente le Spese in FIC.
- Dati temporanei in memoria, senza database. Il blocco degli invii concorrenti e locale al processo: **non e un lock distribuito e non garantisce exactly-once tra istanze Vercel o dopo riavvii**. Usare un solo operatore e una sola scheda per gli invii. Prima di un uso multiutente serve un archivio condiviso delle operazioni con vincolo univoco e gestione degli esiti incerti.
- La verifica dei duplicati si interrompe senza scrivere se non riesce a completare l'elenco (massimo 100 pagine da 100 elementi).

I test usano risposte FIC simulate e non creano spese o TD17 reali. La verifica reale OAuth e del primo salvataggio avviene con consenso dell'utente nell'app. I test coprono anche ticket alterati/scaduti, scope, duplicati, importi, dati FIC cambiati dopo l'anteprima, esito incerto e fallimento XML dopo un salvataggio riuscito.

Riferimenti: [API Received Documents](https://github.com/fattureincloud/fattureincloud-ts-sdk/blob/master/docs/ReceivedDocumentsApi.md), [modello ReceivedDocument](https://github.com/fattureincloud/fattureincloud-ts-sdk/blob/master/docs/ReceivedDocument.md).

TD17: [creazione documenti](https://developers.fattureincloud.it/docs/guides/invoice-creation/), [personalizzazione XML](https://developers.fattureincloud.it/docs/guides/e-invoice-xml-customisation/), [specifica OpenAPI](https://github.com/fattureincloud/openapi-fattureincloud/blob/master/openapi-enriched.yaml), [guida FIC TD17/18/19](https://help-center.fattureincloud.it/help/articolo/647-crea-autofattura-elettronica-td17-td18-td19).
