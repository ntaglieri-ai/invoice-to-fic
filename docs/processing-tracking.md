# Tracciamento spese e TD17

La dashboard separa Raccolta e archivio (mail e PDF su Drive) da Spese e TD17.
Le fatture gestite vengono ricordate online: dati estratti e corretti, approvazione,
riferimento al PDF su Drive, spesa FIC e TD17 con stato. Non e un nuovo archivio PDF.
La memoria e un registro JSON nella cartella Drive "Invoice to FIC - memoria del tool",
gestito dal tool tramite l'account Google collegato, e separato per azienda FIC.
Non salvare o cancellare manualmente questi file di servizio. Non contengono token,
PDF, testi estratti o bozze fiscali dei dialoghi. I PDF originali restano nelle cartelle
Fatture SaaS gia esistenti. Per ritrovare i dati su un altro browser, collegare lo stesso
account Google e selezionare la stessa azienda FIC. Il filtro usa il mese della fattura.

Il tool carica la memoria prima di abilitare le modifiche e salva automaticamente.
Il messaggio "salvate online" appare soltanto dopo conferma del servizio. Un errore
lascia il lavoro aperto e rende disponibile Riprova salvataggio. Il logout e il cambio
azienda sono bloccati finche ci sono modifiche in attesa. Una copia locale della sola
operazione non confermata serve al recupero dopo un'interruzione: non e la memoria
principale. Le operazioni sono idempotenti e le revisioni impediscono a una vecchia
sessione di sovrascrivere modifiche piu recenti. I checkpoint periodici accelerano le
letture senza eliminare le operazioni originali. Le ricerche incomplete non vengono
mai interpretate come una memoria vuota.

Recupera lavoro precedente importa una volta le fatture rimaste nel vecchio browser,
dopo conferma dell'azienda selezionata. I record online e quelli gia rimossi prevalgono
sulla vecchia copia. Ricarica memoria recupera lo stato online; quando ci sono modifiche
non salvate chiede conferma prima di scartarle.

Verifica stati FIC controlla la pagina di revisione corrente. Gli ID conosciuti
sono verificati tramite letture API. Solo una risposta 404 rimuove un collegamento;
errori di connessione o permessi conservano gli stati. Per riferimenti mancanti,
il controllo cerca le spese e i TD17 usando le regole di corrispondenza gia usate
dai controlli duplicati e il VAT del fornitore. Questo consente di recuperare i
riferimenti anche su un altro browser o dopo aver cancellato i dati locali.

Il reset singolo o del mese selezionato azzera solo i riferimenti nella memoria online.
Non elimina documenti FIC o PDF Drive. Una successiva verifica puo recuperare
documenti ancora presenti: per ripartire davvero, eliminare quelli desiderati
in FIC e poi verificare nuovamente. I controlli server contro le duplicazioni
restano attivi anche dopo un reset.

La rimozione di una fattura dalla memoria richiede conferma, viene ricordata online e
non elimina la spesa, il TD17 o il PDF originale. Per recuperare documenti FIC esistenti
resta disponibile Verifica stati FIC dopo aver ricaricato la fattura da Drive.

Spesa creata e TD17 creato sono stati separati. TD17 creato non significa inviato
allo SDI. L'invio rimane una conferma manuale dentro FIC.

Il TD17 usa due indicatori: Creato / non inviato (giallo) e Inviato (verde acqua).
Verifica stati FIC legge anche ei_status: sent, processing, accepted,
not_delivered e no_response indicano che la trasmissione e avvenuta. Gli stati
di attesa, errore, scarto o non conosciuti non sono promossi a verde. Il valore
FIC originale rimane nel tooltip per distinguere eventuali anomalie; verde
indica invio, non necessariamente accettazione o consegna riuscita.
Se un TD17 restituisce 404, vengono rimossi ID e stato TD17, senza eliminare la
fattura di revisione, il PDF Drive o il riferimento alla spesa.
