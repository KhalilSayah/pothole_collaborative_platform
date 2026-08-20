// Drains the offline queue whenever the network allows. Items are removed only
// after the server confirms them, so a failed upload is retried, never lost.

import { peekAll, remove, bumpAttempts, count, type QueueItem } from './queue';
import { isCloudEnabled, pushRide, closeRide, pushObservation, pushFeedback, patchObservation } from './supabase';

export interface SyncState {
  pending: number;
  syncing: boolean;
  lastError: string | null;
  lastSyncAt: number | null;
}

let state: SyncState = { pending: 0, syncing: false, lastError: null, lastSyncAt: null };
const listeners = new Set<(s: SyncState) => void>();

export function onSync(fn: (s: SyncState) => void) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function emit(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach(f => f(state));
}

export async function refreshPending() {
  emit({ pending: await count() });
}

async function send(item: QueueItem) {
  switch (item.kind) {
    case 'ride':        return pushRide(item.body);
    case 'ride_close':  { const { id, ...p } = item.body; return closeRide(id, p); }
    case 'observation': return pushObservation(item.body);
    case 'feedback':    return pushFeedback(item.body);
    case 'observation_patch': { const { id, ...p } = item.body; return patchObservation(id, p); }
  }
}

export async function flush() {
  if (state.syncing) return;
  if (!isCloudEnabled() || !navigator.onLine) { await refreshPending(); return; }

  emit({ syncing: true, lastError: null });
  try {
    const items = await peekAll();
    // Ordered by insertion, so a ride row always precedes its observations —
    // the foreign key would reject them otherwise.
    for (const item of items.sort((a, b) => (a.qid ?? 0) - (b.qid ?? 0))) {
      try {
        await send(item);
        if (item.qid != null) await remove(item.qid);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        // A duplicate key means the server already has it: the previous attempt
        // succeeded and only the acknowledgement was lost. Safe to drop.
        if (/duplicate key|already exists/i.test(msg)) {
          if (item.qid != null) await remove(item.qid);
          continue;
        }
        await bumpAttempts(item);
        emit({ lastError: msg });
        break;   // preserve ordering; retry on the next pass
      }
    }
    emit({ lastSyncAt: Date.now() });
  } finally {
    emit({ syncing: false });
    await refreshPending();
  }
}

export function startAutoSync(intervalMs = 20000) {
  refreshPending();
  const t = setInterval(flush, intervalMs);
  window.addEventListener('online', flush);
  return () => { clearInterval(t); window.removeEventListener('online', flush); };
}

/** Local export — the escape hatch when there is no backend configured. */
export async function exportJson() {
  const items = await peekAll();
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pothole-queue-${new Date().toISOString().slice(0, 19)}.json`;
  a.click();
}

/**
 * Export the labelled waveforms as CSV — one row per labelled event.
 *
 * This is the collection deliverable: features, the raw waveform, and the human
 * label, ready for whatever training you choose to run later. Nothing here
 * trains anything; it only gets the data out.
 */
export async function exportTrainingCsv() {
  const items = await peekAll();
  const labels = new Map<string, any>();
  const obs = new Map<string, any>();
  for (const i of items) {
    if (i.kind === 'feedback') labels.set(i.body.observation_id, i.body);
    if (i.kind === 'observation') obs.set(i.body.id, i.body);
  }

  const cols = [
    'observation_id', 'label', 'training_mode', 'latency_ms',
    'speed_mps', 'peak_g', 'z_score', 'sigma_g', 'baseline_g',
    'leading_sign', 'axle_confirmed', 'duration_ms', 'severity_index',
    'sample_hz', 'forced_sample', 'waveform',
  ];
  const rows = [cols.join(',')];

  for (const [id, fb] of labels) {
    const o = obs.get(id);
    if (!o) continue;                      // already uploaded; not local any more
    const pl = o.payload ?? {};
    rows.push([
      id, fb.label, fb.training_mode ?? false, fb.latency_ms ?? '',
      o.speed_mps ?? '', pl.peak_g ?? '', pl.z_score ?? '', pl.sigma_g ?? '',
      pl.baseline_g ?? '', pl.leading_sign ?? '', pl.axle_confirmed ?? '',
      pl.duration_ms ?? '', pl.severity_index ?? '', pl.sample_hz ?? '',
      pl.forced_sample ?? false,
      // Quoted so the comma-separated samples survive as a single field.
      '"' + (pl.waveform ?? []).join(' ') + '"',
    ].join(','));
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `accel-training-${new Date().toISOString().slice(0, 19)}.csv`;
  a.click();
  return rows.length - 1;
}
