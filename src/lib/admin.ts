// Data access for the back office. Everything here needs an authenticated
// admin; RLS enforces it server-side regardless of what the UI allows.

import { supabase } from './supabase';
import type { Cluster } from './types';

export interface AdminCluster extends Cluster {
  priority: number | null;
  repaired_at: string | null;
  repair_note: string | null;
  assigned_to: string | null;
  first_seen: string;
}

const need = () => {
  if (!supabase) throw new Error('Supabase non configuré');
  return supabase;
};

export async function fetchClusters(): Promise<AdminCluster[]> {
  const sb = need();
  const { data, error } = await sb
    .from('clusters')
    .select('*')
    .order('priority', { ascending: false, nullsFirst: false })
    .limit(3000);
  if (error) throw error;

  // An RLS policy that does not cover the caller's role returns an empty list
  // with HTTP 200 — indistinguishable from an empty database. public_map is a
  // view and bypasses RLS, so rows there but none here identifies the cause
  // precisely instead of leaving a blank screen to interpret.
  if (!data?.length) {
    const { count } = await sb
      .from('public_map')
      .select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) {
      throw new Error(
        `La base contient ${count} signalements, mais aucun n'est lisible avec ce compte. ` +
        'Il manque une policy de lecture sur `clusters` pour le rôle authenticated — ' +
        'lancez supabase/migration_008_admin_read.sql.');
    }
  }
  return (data ?? []) as AdminCluster[];
}

export async function markFixed(id: string, note?: string) {
  const { error } = await need().rpc('mark_fixed', { p_cluster_id: id, p_note: note ?? null });
  if (error) throw error;
}

export async function reopen(id: string, note?: string) {
  const { error } = await need().rpc('reopen_cluster', { p_cluster_id: id, p_note: note ?? null });
  if (error) throw error;
}

export async function refreshPriorities(): Promise<number> {
  const { data, error } = await need().rpc('refresh_priorities');
  if (error) throw error;
  return data as number;
}

export async function view<T>(name: string): Promise<T[]> {
  const { data, error } = await need().from(name).select('*');
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function history(clusterId: string) {
  const { data, error } = await need()
    .from('repairs').select('*')
    .eq('cluster_id', clusterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ---------------------------------------------------------------- derived */

/**
 * Weeks to clear the open backlog at the current repair rate.
 *
 * Arrivals minus repairs, both measured over the same window. This is a
 * queue calculation, not a forecast: it says what happens if both rates hold,
 * which is the only claim the data supports. A growing queue returns null
 * rather than a number, because "never" is the honest answer and a very large
 * number reads as a schedule.
 */
export function backlogOutlook(reported30: number, repaired30: number, open: number) {
  const net = (repaired30 - reported30) / 30;      // per day
  if (net <= 0) return { clearing: false, weeks: null, netPerWeek: net * 7 };
  return { clearing: true, weeks: Math.ceil(open / net / 7), netPerWeek: net * 7 };
}
