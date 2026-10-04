import { randomUUID } from "node:crypto";
import { googleFetch, type GoogleSession } from "./google-session";
import { cleanManagedInvoice, cleanMemoryEvent, replayMemory, type MemoryEvent, type MemoryRecords } from "./invoice-memory";

const MARKER = "invoice-memory-v1";
type FileInfo = { id: string; createdTime: string; appProperties?: { ficMemoryKind?: string } };
type Checkpoint = { records: MemoryRecords; accepted: string[]; seen: string[]; files: string[] };
const params = (q: string, fields: string, pageToken?: string) => new URLSearchParams({ q, fields, pageSize: "100", ...(pageToken ? { pageToken } : {}) });

export async function loadInvoiceMemory(session: GoogleSession, companyId: number) {
  const files: FileInfo[] = [];
  let pageToken: string | undefined;
  do {
    const query = params(`trashed=false and 'me' in owners and mimeType='application/json' and appProperties has { key='ficMemory' and value='${MARKER}' } and appProperties has { key='ficCompany' and value='${companyId}' }`, "files(id,createdTime,appProperties),nextPageToken,incompleteSearch", pageToken);
    query.set("orderBy", "createdTime");
    const data = await (await googleFetch(session, `/drive/v3/files?${query}`)).json();
    if (!Array.isArray(data.files) || data.incompleteSearch) throw new Error("Memoria online incompleta. Nessun dato sostituito.");
    files.push(...data.files);
    pageToken = data.nextPageToken;
    if (files.length > 20000) throw new Error("Memoria online oltre il limite di lettura. Nessun dato sostituito.");
  } while (pageToken);
  if (files.some((file) => !/^[a-zA-Z0-9_-]{1,200}$/.test(file.id) || !Number.isFinite(Date.parse(file.createdTime)))) throw new Error("Memoria online non valida.");
  files.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
  let base: Checkpoint | undefined;
  const checkpoint = files.filter((file) => file.appProperties?.ficMemoryKind === "checkpoint").at(-1);
  if (checkpoint) {
    const raw = await (await googleFetch(session, `/drive/v3/files/${checkpoint.id}?alt=media`)).text();
    if (raw.length > 8000000) throw new Error("Memoria online troppo grande.");
    const data = JSON.parse(raw) as Checkpoint;
    if (!data.records || !Array.isArray(data.files) || !Array.isArray(data.accepted) || !Array.isArray(data.seen) ||
      !data.files.every((id) => /^[a-zA-Z0-9_-]{1,200}$/.test(id)) ||
      ![...data.accepted, ...data.seen].every((id) => /^[a-f0-9-]{36}$/.test(id))) throw new Error("Memoria online non valida.");
    const records: MemoryRecords = {};
    for (const [id, record] of Object.entries(data.records)) {
      if (!id || id.length > 300 || ["__proto__", "constructor", "prototype"].includes(id) || !record || !/^[a-f0-9-]{36}$/.test(record.revision) || !data.accepted.includes(record.revision)) throw new Error("Memoria online non valida.");
      const value = record.value === null ? null : cleanManagedInvoice(record.value);
      if (value && value.id !== id) throw new Error("Memoria online non valida.");
      records[id] = { value, revision: record.revision };
    }
    base = { ...data, records };
  }
  const included = new Set(base?.files);
  const eventFiles = files.filter((file) => file.appProperties?.ficMemoryKind !== "checkpoint" && !included.has(file.id));
  const events: MemoryEvent[] = [];
  for (let offset = 0; offset < eventFiles.length; offset += 8) {
    const batch = await Promise.all(eventFiles.slice(offset, offset + 8).map(async (file) => {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(file.id)) throw new Error("Memoria online non valida.");
      const response = await googleFetch(session, `/drive/v3/files/${file.id}?alt=media`);
      const raw = await response.text();
      if (raw.length > 250000) throw new Error("Registro memoria non valido.");
      return cleanMemoryEvent(JSON.parse(raw));
    }));
    events.push(...batch);
  }
  const state = replayMemory(events, base);
  return { ...state, files: [...included, ...eventFiles.map((file) => file.id)], unfolded: eventFiles.length };
}

async function memoryFolder(session: GoogleSession) {
  const query = params(`trashed=false and 'me' in owners and mimeType='application/vnd.google-apps.folder' and appProperties has { key='ficMemoryFolder' and value='${MARKER}' }`, "files(id)");
  const data = await (await googleFetch(session, `/drive/v3/files?${query}`)).json();
  if (!Array.isArray(data.files)) throw new Error("Cartella memoria non disponibile.");
  if (data.files[0]) return data.files[0].id as string;
  const created = await (await googleFetch(session, "/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Invoice to FIC - memoria del tool", mimeType: "application/vnd.google-apps.folder", appProperties: { ficMemoryFolder: MARKER } }) })).json();
  if (!created.id) throw new Error("Cartella memoria non creata.");
  return created.id as string;
}

export class MemoryConflict extends Error {}

async function writeJson(session: GoogleSession, companyId: number, name: string, data: unknown, kind: "event" | "checkpoint") {
  const parent = await memoryFolder(session);
  const boundary = `memory_${randomUUID()}`;
  const metadata = { name, mimeType: "application/json", parents: [parent], appProperties: { ficMemory: MARKER, ficCompany: String(companyId), ficMemoryKind: kind } };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--\r\n`;
  await googleFetch(session, "/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
}

export async function saveInvoiceMemory(session: GoogleSession, companyId: number, event: MemoryEvent) {
  const current = await loadInvoiceMemory(session, companyId);
  if (current.accepted.has(event.operationId)) return current.records;
  if (event.changes.some((change) => (current.records[change.id]?.revision ?? null) !== change.expectedRevision)) throw new MemoryConflict("Fatture aggiornate da un'altra sessione. Ricarica la memoria prima di modificare.");
  await writeJson(session, companyId, `${event.operationId}.json`, event, "event");
  const saved = await loadInvoiceMemory(session, companyId);
  if (!saved.accepted.has(event.operationId)) throw new MemoryConflict("Salvataggio non confermato. Riprova; nessun documento FIC sara duplicato.");
  // Periodic metadata checkpoints keep later reads fast. Original events are retained for recovery and concurrent writes.
  if (saved.unfolded >= 50) {
    try { await writeJson(session, companyId, `memoria-${randomUUID()}.json`, { records: saved.records, accepted: [...saved.accepted], seen: [...saved.seen], files: saved.files }, "checkpoint"); }
    catch { console.warn("[invoice-memory] checkpoint deferred"); }
  }
  return saved.records;
}
