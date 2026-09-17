// FIC supports :r (read) and :a (full access), not :rw.
export const FIC_EXPENSE_WRITE_SCOPE = "received_documents:a";

export function canWriteExpenses(scope?: string) {
  return Boolean(scope?.split(/\s+/).includes(FIC_EXPENSE_WRITE_SCOPE));
}

export function ficConnectionNotice(result: string | null, connected: boolean, scope?: string) {
  const errors: Record<string, string> = {
    "invalid-scope": "Fatture in Cloud ha rifiutato i permessi richiesti. Riprova con Autorizza spese; se il problema persiste, la configurazione va corretta.",
    "access-denied": "Autorizzazione non concessa. Premi Autorizza spese e conferma i permessi in Fatture in Cloud.",
    "authorization-error": "Fatture in Cloud non ha completato l'autorizzazione. Riprova il collegamento.",
    "invalid-state": "Il collegamento e scaduto o la sessione non coincide. Riprova dallo stesso browser.",
    "missing-code": "Fatture in Cloud non ha restituito il codice di autorizzazione. Riprova il collegamento.",
    "token-error": "Non e stato possibile completare il collegamento a Fatture in Cloud. Riprova; se persiste, controllare la configurazione OAuth.",
    "missing-config": "Configurazione Fatture in Cloud incompleta. Il collegamento non puo essere avviato.",
  };
  if (result && errors[result]) return { error: true, message: errors[result] };
  if (result !== "connected") return null;
  if (!connected) return { error: true, message: "Autorizzazione ricevuta, ma la connessione a Fatture in Cloud non e disponibile. Premi Aggiorna." };
  if (!canWriteExpenses(scope)) return { error: true, message: "Collegamento riuscito, ma mancano i permessi per creare spese. Premi Autorizza spese." };
  return { error: false, message: "Autorizzazione completata. Ora puoi caricare una fattura, approvarla e preparare la spesa." };
}
