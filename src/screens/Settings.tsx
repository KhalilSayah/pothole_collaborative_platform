import { useEffect, useState } from 'react';
import { onSync, flush, exportJson, exportTrainingCsv, type SyncState } from '../lib/sync';
import { clear } from '../lib/queue';
import { isCloudEnabled } from '../lib/supabase';
import type { RideController } from '../lib/ride';

export default function Settings({ ride }: { ride: RideController }) {
  const [s, setS] = useState<SyncState>({ pending: 0, syncing: false, lastError: null, lastSyncAt: null });
  const [lag, setLag] = useState(ride.reaction_lag_s);
  const [k, setK] = useState(ride.detector.cfg.k_sigma);

  useEffect(() => { const off = onSync(setS); return () => { off(); }; }, []);

  return (
    <>
      <div className="card">
        <h2>Synchronisation</h2>
        <div className="row">
          <div className="grow">
            <b style={{ fontSize: 22 }}>{s.pending}</b>
            <span className="muted"> en attente d’envoi</span>
          </div>
          <span className={'chip ' + (isCloudEnabled() ? 'ok' : 'warn')}>
            {isCloudEnabled() ? 'Cloud actif' : 'Local uniquement'}
          </span>
        </div>
        {s.lastError && <div className="banner bad" style={{ marginTop: 10 }}>{s.lastError}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={flush} disabled={s.syncing || !isCloudEnabled()}>
            {s.syncing ? 'Envoi…' : 'Envoyer maintenant'}
          </button>
          <button className="btn ghost" onClick={exportJson}>Exporter JSON</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Rien n’est supprimé de la file tant que le serveur n’a pas confirmé.
          Vous pouvez rouler sans réseau sans perdre de données.
        </p>
      </div>

      <div className="card">
        <h2>Réglages avancés</h2>

        <label className="muted">Temps de réaction : {lag.toFixed(1)} s</label>
        <input
          type="range" min={0} max={3} step={0.1} value={lag}
          onChange={e => { const v = +e.target.value; setLag(v); ride.reaction_lag_s = v; }}
          style={{ width: '100%' }}
        />
        <p className="muted">
          Un signalement est tapé après le passage sur le défaut. La position est
          donc corrigée en arrière de (temps × vitesse) — à 50 km/h, 1,4 s
          représente environ 19 m.
        </p>

        <label className="muted" style={{ display: 'block', marginTop: 16 }}>
          Sensibilité : {k.toFixed(1)} σ
        </label>
        <input
          type="range" min={3} max={7} step={0.25} value={k}
          onChange={e => { const v = +e.target.value; setK(v); ride.detector.cfg.k_sigma = v; }}
          style={{ width: '100%' }}
        />
        <p className="muted">
          Plus bas = plus de détections et plus de fausses alertes. La valeur est
          enregistrée avec chaque trajet, ce qui permet de la réajuster plus tard
          à partir de vos réponses Oui/Non.
        </p>
      </div>

      <div className="card">
        <h2>Données d’entraînement</h2>
        <p className="muted">
          Chaque événement étiqueté est enregistré avec son signal brut, sa vitesse
          et ses caractéristiques. Exportez-les pour constituer le jeu de données.
        </p>
        <button
          className="btn ghost" style={{ marginTop: 10 }}
          onClick={async () => {
            const n = await exportTrainingCsv();
            if (!n) alert('Aucun événement étiqueté en attente. Les données déjà envoyées se récupèrent via la vue accel_training_set dans Supabase.');
          }}
        >Exporter le jeu de données (CSV)</button>
      </div>

      <div className="card">
        <h2>Confidentialité</h2>
        <p className="muted">
          Aucun compte, aucun identifiant, aucune donnée personnelle. Chaque trajet
          reçoit un identifiant aléatoire, non lié à l’appareil ni aux trajets
          précédents. Seules la position des défauts et les mesures de capteur
          sont transmises.
        </p>
      </div>

      <button
        className="btn ghost"
        onClick={async () => {
          if (confirm('Supprimer définitivement toutes les données en attente ?')) {
            await clear();
            location.reload();
          }
        }}
      >Vider la file locale</button>
    </>
  );
}
