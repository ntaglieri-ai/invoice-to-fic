# Tracciamento spese e TD17

La schermata principale e il registro mensile Fatture estere. Acquisisci fatture
apre un drawer separato per Gmail, Drive e PDF dal computer. Il dettaglio di ogni
fattura contiene correzioni, approvazione, spesa e TD17 come passi successivi.
L'acquisizione aggiunge il documento al registro, senza scritture finanziarie FIC.
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

Aggiorna da FIC controlla tutto il mese selezionato, non solo la pagina visibile. Gli ID conosciuti
sono verificati tramite letture API. Solo una risposta 404 rimuove un collegamento;
errori di connessione o permessi conservano gli stati. Per riferimenti mancanti,
il controllo cerca le spese e i TD17 usando le regole di corrispondenza gia usate
dai controlli duplicati e il VAT del fornitore. Questo consente di recuperare i
riferimenti anche su un altro browser o dopo aver cancellato i dati locali.

Il reset singolo nel dettaglio azzera solo i riferimenti nella memoria online.
Non elimina documenti FIC o PDF Drive. Una successiva verifica puo recuperare
documenti ancora presenti: per ripartire davvero, eliminare quelli desiderati
in FIC e poi verificare nuovamente. I controlli server contro le duplicazioni
restano attivi anche dopo un reset.

La rimozione di una fattura dalla memoria richiede conferma, viene ricordata online e
non elimina la spesa, il TD17 o il PDF originale. Per recuperare documenti FIC esistenti
si puo selezionare un mese per recuperarli direttamente da FIC.

## Recupero Mensile Da FIC

Selezionare un mese nel registro legge le spese FIC del mese e dell'azienda
selezionata anche quando la memoria online e vuota. Sono riconosciuti OpenAI,
Anthropic, Vercel, Hetzner e Supabase. I TD17 vengono associati tramite le stesse
regole dei controlli duplicati (riferimento originale e fornitore, oppure marker
del tool), non per il solo importo. Le fatture recuperate vengono ricordate online.
Aggiorna da FIC ripete il recupero e verifica tutti i riferimenti gia noti del mese.
Nessuna creazione, cancellazione o trasmissione SDI viene eseguita.

Un TD17 senza una spesa sorgente ancora presente non viene ricostruito da zero
da questo recupero; se gia nella memoria, viene comunque verificato. Le fatture
gia ricordate e i PDF Drive non vengono rimossi quando un mese FIC e vuoto o una
lettura fallisce. Reset e rimozione sono raggruppati in Altre azioni.

Il registro ha ricerca, filtri di lavorazione e paginazione (8, 16 o 32 righe).
Le impostazioni azienda e connessioni sono in un drawer dedicato. I dialoghi di
spesa e TD17 mantengono anteprima e conferma obbligatoria; i dati della fattura
restano stabili mentre la conferma e aperta, anche durante il salvataggio online.
Le fatture recuperate da FIC possono essere collegate al PDF acquisito da Drive
senza aggiungere una seconda riga con la stessa identita.

Spesa creata e TD17 creato sono stati separati. TD17 creato non significa inviato
allo SDI. L'invio rimane una conferma manuale dentro FIC.

Il TD17 usa due indicatori: Creato / non inviato (giallo) e Inviato (verde acqua).
Aggiorna da FIC legge anche ei_status: sent, processing, accepted,
not_delivered e no_response indicano che la trasmissione e avvenuta. Gli stati
di attesa, errore, scarto o non conosciuti non sono promossi a verde. Il valore
FIC originale rimane nel tooltip per distinguere eventuali anomalie; verde
indica invio, non necessariamente accettazione o consegna riuscita.
Se un TD17 restituisce 404, vengono rimossi ID e stato TD17, senza eliminare la
fattura di revisione, il PDF Drive o il riferimento alla spesa.
