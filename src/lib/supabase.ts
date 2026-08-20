import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase is optional at runtime.
 *
 * With no credentials the app still works completely: rides and observations
 * accumulate in IndexedDB and can be exported as JSON. This means the collector
 * can be tested on a real drive before any backend exists, and a driver whose
 * credentials fail never silently loses data.
 */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

export const isCloudEnabled = () => supabase !== null;

export async function pushRide(ride: any) {
  if (!supabase) throw new Error('offline-only');
  const { error } = await supabase.from('rides').insert(ride);
  if (error) throw error;
}

export async function closeRide(id: string, patch: any) {
  if (!supabase) throw new Error('offline-only');
  const { error } = await supabase.from('rides').update(patch).eq('id', id);
  if (error) throw error;
}

export async function pushObservation(obs: any) {
  if (!supabase) throw new Error('offline-only');
  const { error } = await supabase.from('observations').insert(obs);
  if (error) throw error;
}

export async function patchObservation(id: string, patch: any) {
  if (!supabase) throw new Error('offline-only');
  const { error } = await supabase.from('observations').update(patch).eq('id', id);
  if (error) throw error;
}

export async function pushFeedback(fb: any) {
  if (!supabase) throw new Error('offline-only');
  const { error } = await supabase.from('accel_feedback').insert(fb);
  if (error) throw error;
}

/** The public fused map. Reads the aggregated view, never raw observations. */
export async function fetchMap(bbox?: [number, number, number, number]) {
  if (!supabase) return [];
  let q = supabase.from('public_map').select('*').limit(2000);
  if (bbox) {
    const [s, w, n, e] = bbox;
    q = q.gte('lat', s).lte('lat', n).gte('lon', w).lte('lon', e);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Upload a report photo to Supabase Storage.
 *
 * Images are downscaled before upload: a modern phone produces 4–8 MB shots, and
 * a verification model gains nothing from that resolution while a person on
 * mobile data pays for every byte.
 */
export async function uploadPhoto(blob: Blob, name: string): Promise<string> {
  if (!supabase) throw new Error('offline-only');
  const path = `reports/${new Date().toISOString().slice(0, 10)}/${name}`;
  const { error } = await supabase.storage
    .from('pothole-images')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

export function publicPhotoUrl(path: string): string | null {
  if (!supabase) return null;
  return supabase.storage.from('pothole-images').getPublicUrl(path).data.publicUrl;
}
