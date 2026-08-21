import { useState } from 'react';
import { signIn } from '../../lib/auth';
import { isCloudEnabled } from '../../lib/supabase';

export default function Login({ forbidden }: { forbidden?: string | null }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try { await signIn(email.trim(), pw); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="wrap sec">
      <div className="narrow" style={{ maxWidth: 420 }}>
        <div className="eyebrow">Espace gestion</div>
        <h2>Connexion</h2>

        {forbidden && (
          <div className="note bad" style={{ marginTop: 20 }}>
            <span>✕</span>
            <span>
              <b>{forbidden}</b> est authentifié mais n’a pas accès à la gestion.
              Un compte doit être ajouté à la table <code>admins</code>.
            </span>
          </div>
        )}

        <form onSubmit={submit} style={{ marginTop: 24 }}>
          <div className="field">
            <label htmlFor="em">Adresse e-mail</label>
            <input id="em" type="email" autoComplete="username" required
                   value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pw">Mot de passe</label>
            <input id="pw" type="password" autoComplete="current-password" required
                   value={pw} onChange={e => setPw(e.target.value)} />
          </div>

          {err && <div className="note bad" style={{ marginBottom: 16 }}><span>✕</span><span>{err}</span></div>}
          {!isCloudEnabled() && (
            <div className="note warn" style={{ marginBottom: 16 }}>
              <span>⚠️</span><span>Supabase n’est pas configuré sur ce déploiement.</span>
            </div>
          )}

          <button className="btn lg block" disabled={busy || !isCloudEnabled()}>
            {busy && <span className="spin" />}Se connecter
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 20 }}>
          Les comptes sont créés uniquement depuis Supabase. Il n’y a pas
          d’inscription : sur un jeu de données public, un accès que chacun peut
          s’octroyer n’en est pas un.
        </p>
      </div>
    </div>
  );
}
