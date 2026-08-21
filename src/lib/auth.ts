// ============================================================================
//  Admin session.
//
//  There is no sign-up path, by design. Accounts are created in the Supabase
//  dashboard and granted access by a row in `admins`. Being authenticated is
//  not the same as being staff: a self-serve signup on a civic dataset would
//  let anyone mark potholes as repaired.
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Admin {
  id: string;
  email: string | null;
  name: string | null;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; admin: Admin }
  | { status: 'forbidden'; email: string | null };

export function useAuth(): AuthState & { signOut: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const sb = supabase;
    if (!sb) { setState({ status: 'anon' }); return; }

    let alive = true;

    const resolve = async (session: any) => {
      if (!alive) return;
      if (!session?.user) { setState({ status: 'anon' }); return; }

      // Authenticated is not authorised. The admins row is the actual gate, so
      // revoking access is a delete rather than a password change.
      const { data, error } = await sb
        .from('admins')
        .select('user_id, email, display_name')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!alive) return;
      if (error || !data) {
        setState({ status: 'forbidden', email: session.user.email ?? null });
        return;
      }
      setState({
        status: 'authed',
        admin: {
          id: data.user_id,
          email: data.email ?? session.user.email ?? null,
          name: data.display_name ?? null,
        },
      });
    };

    sb.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => resolve(s));

    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    await supabase?.auth.signOut();
    setState({ status: 'anon' });
  };

  return { ...state, signOut };
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns the same message for a wrong password and an unknown
    // address, on purpose — it stops the form being used to enumerate accounts.
    throw new Error(
      /invalid login/i.test(error.message)
        ? 'Identifiants incorrects.'
        : error.message);
  }
}
