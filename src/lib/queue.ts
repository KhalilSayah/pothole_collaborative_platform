// ============================================================================
//  Offline-first upload queue.
//
//  This app runs in a moving car, which is exactly where mobile data drops out.
//  Losing a report because a tunnel ate the request would be unacceptable, so
//  every observation is written to IndexedDB FIRST and uploaded afterwards.
//  Nothing is removed from the queue until the server has confirmed it.
// ============================================================================

const DB_NAME = 'pothole-collect';
const STORE = 'queue';
const VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'qid', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export interface QueueItem {
  qid?: number;
  kind: 'ride' | 'observation' | 'ride_close' | 'feedback' | 'observation_patch';
  body: any;
  queued_at: number;
  attempts: number;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(kind: QueueItem['kind'], body: any) {
  return tx<number>('readwrite', s =>
    s.add({ kind, body, queued_at: Date.now(), attempts: 0 } as QueueItem));
}

export async function peekAll(): Promise<QueueItem[]> {
  return tx<QueueItem[]>('readonly', s => s.getAll());
}

export async function remove(qid: number) {
  return tx<void>('readwrite', s => s.delete(qid));
}

export async function bumpAttempts(item: QueueItem) {
  item.attempts += 1;
  return tx<void>('readwrite', s => s.put(item));
}

export async function count(): Promise<number> {
  return tx<number>('readonly', s => s.count());
}

export async function clear() {
  return tx<void>('readwrite', s => s.clear());
}
