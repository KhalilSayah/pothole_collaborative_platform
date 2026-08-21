import { useAuth } from '../../lib/auth';
import Login from './Login';
import AdminMap from './AdminMap';
import Analytics from './Analytics';

export default function AdminShell({ route }: { route: string }) {
  const auth = useAuth();

  if (auth.status === 'loading') {
    return <div className="wrap sec center"><span className="spin" /> Vérification de la session…</div>;
  }
  if (auth.status === 'anon') return <Login />;
  if (auth.status === 'forbidden') return <Login forbidden={auth.email} />;

  const tab = route === '/admin/analyse' ? 'analyse' : 'carte';

  return (
    <div className="admin">
      <div className="admin-bar">
        <span className="admin-brand">
          <span className="mark" style={{ width: 24, height: 24, fontSize: 12 }}>◎</span>
          Gestion
        </span>
        <nav className="admin-tabs">
          <a href="#/admin" className={tab === 'carte' ? 'on' : ''}>Carte</a>
          <a href="#/admin/analyse" className={tab === 'analyse' ? 'on' : ''}>Analyse</a>
        </nav>
        <span className="grow" />
        <span className="small muted" title={auth.admin.email ?? ''}>
          {auth.admin.name ?? auth.admin.email}
        </span>
        <button className="btn ghost" style={{ padding: '8px 14px' }} onClick={auth.signOut}>
          Déconnexion
        </button>
      </div>

      <div className="admin-body">
        {tab === 'carte' ? <AdminMap /> : <Analytics />}
      </div>
    </div>
  );
}
