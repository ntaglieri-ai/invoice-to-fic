# Tracciamento spese e TD17

La dashboard separa Raccolta e archivio (mail e PDF su Drive) da Spese e TD17.
I PDF e le bozze di revisione restano temporanei. Solo i riferimenti di elaborazione
sono salvati nel browser, per azienda FIC, fornitore e numero fattura.
Non vengono salvati token, PDF o testi estratti nel registro del browser.

Verifica stati FIC controlla la pagina di revisione corrente. Gli ID conosciuti
sono verificati tramite letture API. Solo una risposta 404 rimuove un collegamento;
errori di connessione o permessi conservano gli stati. Per riferimenti mancanti,
il controllo cerca le spese e i TD17 usando le regole di corrispondenza gia usate
dai controlli duplicati e il VAT del fornitore. Questo consente di recuperare i
riferimenti anche su un altro browser o dopo aver cancellato i dati locali.

Il reset singolo o dell'elenco caricato azzera solo i riferimenti nel browser.
Non elimina documenti FIC o PDF Drive. Una successiva verifica puo recuperare
documenti ancora presenti: per ripartire davvero, eliminare quelli desiderati
in FIC e poi verificare nuovamente. I controlli server contro le duplicazioni
restano attivi anche dopo un reset.

Spesa creata e TD17 creato sono stati separati. TD17 creato non significa inviato
allo SDI. L'invio rimane una conferma manuale dentro FIC.
