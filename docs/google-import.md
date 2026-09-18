# Raccolta Gmail e archivio Drive

## Configurazione (una tantum)

1. In Google Cloud Console crea o scegli un progetto personale, ad esempio `Invoice to FIC`.
2. Abilita **Gmail API** e **Google Drive API**.
3. In Google Auth Platform configura nome app, email di assistenza e audience **External**. Se lasci lo stato Testing, aggiungi il tuo indirizzo Gmail fra i test users.
4. Configura gli scope `https://www.googleapis.com/auth/gmail.readonly` e `https://www.googleapis.com/auth/drive.file`.
5. Crea un client OAuth di tipo **Web application** con redirect esatto:
   `https://invoice-to-fic.vercel.app/api/google/callback`
6. Aggiungi le variabili Vercel Production `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Sensitive) e `GOOGLE_REDIRECT_URI`. L'app usa il gia presente `APP_SESSION_SECRET` per cifrare la sessione Google. Non pubblicare il client secret nel repository o nella chat.
7. Esegui un nuovo deploy, poi premi **Collega Google** e concedi entrambi i permessi.

In Testing Google puo far scadere il refresh token dopo 7 giorni: ricollega l'account. Pubblicazione e verifica degli scope Gmail restricted richiedono una valutazione separata prima di distribuire l'app ad altri utenti. Non aggirare gli avvisi Google. Per uso personale verifica le condizioni Google applicabili.

## Comportamento

- Ricerca manuale, nessun cron: legge solo i messaggi etichettati esattamente `Fatture SaaS` nel mese di ricezione scelto (fuso Europe/Rome). Il permesso Gmail e tecnicamente piu ampio: Google non offre uno scope limitato a una sola etichetta. L'app non modifica, cancella o invia mail.
- Pagine da 10 mail con pulsante Altre mail; Importa fatture elencate elabora solo le righe caricate, una alla volta. Un errore non blocca le altre righe.
- Mittenti iniziali verificati sugli esempi: OpenAI `noreply@tm.openai.com`, Anthropic `invoice+statements@mail.anthropic.com`, Vercel `invoice+statements@vercel.com`, Supabase `invoice+statements@supabase.com`, Hetzner `billing@hetzner.com`. Un mittente diverso non viene importato automaticamente. Questa allowlist non e un controllo DKIM: la revisione umana resta obbligatoria.
- Fatture PDF riconosciute anche con MIME `application/octet-stream`; magic bytes e limite 10 MB controllati. Le ricevute sono escluse, **non archiviate** in questa versione.
- OpenAI: link specifico Visualizza la fattura/View invoice, redirect HTTPS consentiti, browser Chromium isolato senza cookie utente e senza credenziali, nessuna interazione di pagamento. Solo download fattura da Stripe. Numero documento confrontato con la mail; se login/link scaduto/blocco browser, la riga conserva un errore e il collegamento alla mail. Non promette successo per tutti i link futuri.
- Drive: crea una cartella privata `Fatture SaaS/ANNO/MESE/FORNITORE` in base alla data estratta dal documento. Data mancante: `Da verificare/FORNITORE`. Non condivide file e non accede ai file Drive non autorizzati all'app. Le correzioni manuali successive in dashboard non rinominano/spostano il PDF.
- Metadati privati Drive conservano hash del PDF, origine messaggio/parte e chiave fornitore+numero quando estratti senza warning. Una nuova importazione del documento gia archiviato lo rilegge da Drive senza aggiungerne una copia; se stesso numero ma contenuto diverso richiede verifica. Cestino Drive escluso: un documento rimosso puo essere nuovamente archiviato.
- La protezione concorrente e per worker, non distribuita: usare una sola scheda per importare. Richieste simultanee su worker diversi o timeout ambigui possono creare duplicati; nessuna garanzia exactly-once. Nessun retry automatico dei POST Drive.
- I risultati della revisione restano temporanei. PDF e indice di archivio sono persistenti su Drive; non vengono conservati nel repository. Ricaricando la pagina, Cerca mail e Importa ricostruiscono la revisione dall'archivio.
- Cookie Google HttpOnly cifrato AES-GCM, OAuth state legato al login e PKCE, rinnovo token server-side. Nessun token nel browser JS o in localStorage. Scollega rimuove la sessione locale ma non cancella i PDF; per revocare il grant usare le connessioni del proprio account Google.
- Nessun nuovo invio a FIC o SDI. Gli importi di valute diverse hanno totali separati; registrazione spese e TD17 rimangono limitati a EUR.

## Sviluppo e verifica

`CHROMIUM_EXECUTABLE_PATH` consente di usare Chrome locale su macOS. Su Vercel si usa `@sparticuz/chromium`, incluso nel file tracing della route Google; runtime Node e maxDuration 120 secondi. Verificare il piano Vercel se impone limiti inferiori.

Test automatici usano mail sintetiche e API mock: nessun documento personale nel repository e nessuna scrittura su Drive durante i test. Il collegamento reale richiede OAuth configurato e conferma del titolare.

Riferimenti ufficiali:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- https://developers.google.com/workspace/drive/api/guides/properties
