// Analysis dashboard.
//
// Built around one question a maintenance team actually has to answer: what do
// we fix next, and are we keeping up. Every figure here is computed from the
// data, and where the data cannot support a claim the panel says so rather than
// filling the space with a plausible-looking number.

import { useEffect, useState } from 'react';
import { view, refreshPriorities, backlogOutlook, type AdminCluster } from '../../lib/admin';
import { fetchClusters } from '../../lib/admin';
import { Frame, Legend, LineChart, BarChart, RankChart } from '../../components/charts/Chart';
import { SERIES, AGE_RAMP, SEV, sevColor, fmt } from '../../lib/viz';
import { SEVERITY_LABEL, cardFor } from '../../lib/damage';

interface Summary {
  open_total: number; open_high: number; repaired_total: number;
  repaired_30d: number; reported_30d: number; pending_reports: number;
  avg_open_age_days: number | null; avg_time_to_repair: number | null;
  deteriorating: number; recurring: number;
}
interface Flow { day: string; reported: number; repaired: number; }
interface Aging { bucket: string; ord: number; n: number; high: number; }
interface Road { road: string; road_type: string | null; total: number; open: number; high_open: number; avg_priority: number | null; has_exact_name?: boolean; }
interface Deter { id: string; road_name: string | null; first_severity: string; latest_severity: string; days_span: number; priority: number | null; }
interface Recur { id: string; road_name: string | null; sightings_since_repair: number; repaired_at: string; }

export default function Analytics() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [flow, setFlow] = useState<Flow[]>([]);
  const [aging, setAging] = useState<Aging[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [deter, setDeter] = useState<Deter[]>([]);
  const [recur, setRecur] = useState<Recur[]>([]);
  const [top, setTop] = useState<AdminCluster[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      view<Summary>('admin_summary'),
      view<Flow>('admin_flow_daily'),
      view<Aging>('admin_aging'),
      view<Road>('admin_roads'),
      view<Deter>('admin_deteriorating'),
      view<Recur>('admin_recurrence'),
      fetchClusters(),
    ]).then(([s, f, a, r, d, rc, cl]) => {
      setSum(s[0] ?? null); setFlow(f); setAging(a); setRoads(r);
      setDeter(d); setRecur(rc);
      setTop(cl.filter(c => !c.repaired_at).slice(0, 12));
    }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <div className="wrap sec"><span className="spin" /> Chargement…</div>;
  if (err) return <div className="wrap sec"><div className="note bad"><span>✕</span><span>{err}</span></div></div>;
  if (!sum) return <div className="wrap sec">Aucune donnée.</div>;

  const outlook = backlogOutlook(sum.reported_30d, sum.repaired_30d, sum.open_total);

  // 90 daily points is unreadable at this width; weekly buckets keep the trend
  // legible without smoothing the signal away.
  const weeks: { label: string; rep: number; fix: number }[] = [];
  for (let i = 0; i < flow.length; i += 7) {
    const chunk = flow.slice(i, i + 7);
    if (!chunk.length) continue;
    weeks.push({
      label: new Date(chunk[0].day).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      rep: chunk.reduce((a, b) => a + b.reported, 0),
      fix: chunk.reduce((a, b) => a + b.repaired, 0),
    });
  }

  return (
    <div className="wrap" style={{ paddingBlock: 32 }}>
      <header className="row" style={{ marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div className="grow">
          <div className="eyebrow">Analyse</div>
          <h2 style={{ fontSize: '1.9rem' }}>État du réseau</h2>
        </div>
        <button className="btn ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await refreshPriorities(); load(); } catch (e: any) { setErr(e.message); }
          finally { setBusy(false); }
        }}>
          {busy && <span className="spin" />}Recalculer les priorités
        </button>
      </header>

      {/* ------------------------------------------------ headline tiles */}
      <div className="tiles">
        <div className="tile">
          <span>Défauts ouverts</span>
          <b>{fmt(sum.open_total)}</b>
          <em style={{ color: SEV.high }}>{fmt(sum.open_high)} graves</em>
        </div>
        <div className="tile">
          <span>Réparés (30 j)</span>
          <b>{fmt(sum.repaired_30d)}</b>
          <em>{fmt(sum.reported_30d)} signalés sur la période</em>
        </div>
        <div className="tile">
          <span>Âge moyen en attente</span>
          <b>{sum.avg_open_age_days ?? '—'}<small> j</small></b>
          <em>{sum.avg_time_to_repair != null
            ? `${sum.avg_time_to_repair} j jusqu’à réparation`
            : 'aucune réparation encore'}</em>
        </div>
        <div className="tile">
          <span>En attente de vérification</span>
          <b>{fmt(sum.pending_reports)}</b>
          <em>signalements photo non traités</em>
        </div>
      </div>

      {/* ------------------------------------------------ backlog outlook */}
      <div className={'note ' + (outlook.clearing ? 'ok' : 'warn')} style={{ marginTop: 20 }}>
        <span>{outlook.clearing ? '✓' : '⚠️'}</span>
        <span>
          {outlook.clearing ? (
            <>Au rythme des 30 derniers jours, le retard se résorbe :
              environ <b>{outlook.weeks} semaines</b> pour traiter les {fmt(sum.open_total)} défauts ouverts.</>
          ) : (
            <>Au rythme des 30 derniers jours, le retard <b>s’accroît</b> d’environ{' '}
              <b>{Math.abs(outlook.netPerWeek).toFixed(1)} défauts par semaine</b>. Aucune date
              de résorption ne peut être annoncée tant que les réparations ne dépassent pas
              les signalements.</>
          )}
        </span>
      </div>

      {/* ------------------------------------------------ flow */}
      <div className="grid g2" style={{ marginTop: 22, alignItems: 'start' }}>
        <Frame
          title="Signalements et réparations"
          sub="Par semaine, sur 90 jours"
          right={<Legend items={[
            { color: SERIES[1], label: 'Signalés' },
            { color: SERIES[0], label: 'Réparés' },
          ]} />}
          note="Les deux courbes partagent une seule échelle : deux axes y feraient apparaître un croisement là où il n’y en a pas."
        >
          <LineChart
            labels={weeks.map(w => w.label)}
            series={[
              { label: 'Signalés', color: SERIES[1], values: weeks.map(w => w.rep) },
              { label: 'Réparés',  color: SERIES[0], values: weeks.map(w => w.fix) },
            ]}
          />
        </Frame>

        <Frame
          title="Ancienneté des défauts ouverts"
          sub="Répartition par tranche d’attente"
          note="Des tranches plutôt qu’une moyenne : une moyenne masque la queue, et c’est la queue qui pose problème."
        >
          <BarChart rows={aging.map((a, i) => ({
            label: a.bucket, value: a.n, color: AGE_RAMP[Math.min(i, AGE_RAMP.length - 1)],
          }))} />
        </Frame>
      </div>

      {/* ------------------------------------------------ priority */}
      <div className="grid g2" style={{ marginTop: 22, alignItems: 'start' }}>
        <Frame
          title="À traiter en priorité"
          sub="Score composite : gravité, exposition, classe de route, certitude"
          note="L’âge n’entre pas dans le score. Un défaut ne devient pas plus dangereux parce qu’on l’a ignoré, et l’y inclure ferait passer un défaut mineur devant un défaut grave."
        >
          <div className="ptable">
            {top.map((c, i) => (
              <div className="prow" key={c.id}>
                <span className="prank">{i + 1}</span>
                <span className="pdot" style={{ background: sevColor(c.severity) }} />
                <div className="grow">
                  <b>{cardFor(c.damage_type ?? 'other')?.label ?? 'Défaut'}</b>
                  <span className="small muted"> · {c.road_name ?? 'rue non nommée'}</span>
                  {/* Severity fills are under 3:1 on white, so the level is
                      spelled out rather than left to the dot. */}
                  <div className="small muted">
                    {SEVERITY_LABEL[c.severity ?? 'low']} · {c.n_rides} passage{c.n_rides > 1 ? 's' : ''}
                  </div>
                </div>
                <span className="pscore">{Math.round(c.priority ?? 0)}</span>
              </div>
            ))}
            {!top.length && <p className="small muted">Aucun défaut ouvert.</p>}
          </div>
        </Frame>

        <Frame
          title="Rues les plus touchées"
          sub="Défauts ouverts par voie"
          note="Réparer un axe en une passe coûte bien moins cher au m² que d’y revenir trou par trou : la rue est l’unité de planification. OpenStreetMap ne nomme que 7 % des voies à Tlemcen ; les libellés marqués ≈ sont des repères de proximité, pas des noms officiels."
        >
          <RankChart rows={roads.slice(0, 10).map(r => ({
            label: r.road + (r.has_exact_name === false ? ' ≈' : ''),
            value: r.open,
            color: r.high_open > 0 ? SEV.high : SERIES[0],
          }))} />
          <Legend items={[
            { color: SEV.high, label: 'contient au moins un défaut grave' },
            { color: SERIES[0], label: 'aucun défaut grave' },
          ]} />
        </Frame>
      </div>

      {/* ------------------------------------------------ prediction */}
      <div className="grid g2" style={{ marginTop: 22, alignItems: 'start' }}>
        <Frame
          title="Défauts qui s’aggravent"
          sub="Gravité en hausse entre la première et la dernière observation"
          note="C’est la seule prédiction que les données permettent : ce qui se dégrade déjà est le meilleur candidat pour la prochaine défaillance. Aucune projection saisonnière n’est possible avant une année complète de relevés."
        >
          {deter.length ? (
            <div className="ptable">
              {deter.slice(0, 8).map(d => (
                <div className="prow" key={d.id}>
                  <span className="pdot" style={{ background: sevColor(d.latest_severity) }} />
                  <div className="grow">
                    <b>{d.road_name ?? 'rue non nommée'}</b>
                    <div className="small muted">
                      {SEVERITY_LABEL[d.first_severity]} → <b>{SEVERITY_LABEL[d.latest_severity]}</b>
                      {' '}en {d.days_span} j
                    </div>
                  </div>
                  <span className="pscore">{Math.round(d.priority ?? 0)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              Aucune aggravation détectée. Il faut au moins deux observations
              espacées d’un même défaut pour qu’une tendance existe.
            </p>
          )}
        </Frame>

        <Frame
          title="Réparations qui n’ont pas tenu"
          sub="Défauts re-signalés après avoir été marqués réparés"
          note="Soit la réparation a échoué, soit la chaussée est structurellement atteinte en dessous. Les deux méritent d’être connus avant de payer une seconde fois."
        >
          {recur.length ? (
            <div className="ptable">
              {recur.slice(0, 8).map(r => (
                <div className="prow" key={r.id}>
                  <span className="pdot" style={{ background: SEV.high }} />
                  <div className="grow">
                    <b>{r.road_name ?? 'rue non nommée'}</b>
                    <div className="small muted">
                      réparé le {new Date(r.repaired_at).toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <span className="pscore">{r.sightings_since_repair}×</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">
              Aucune récurrence. Ce panneau se remplit lorsqu’un défaut marqué
              réparé est de nouveau signalé.
            </p>
          )}
        </Frame>
      </div>

      <p className="small muted" style={{ marginTop: 28 }}>
        Chiffres calculés à la demande depuis les signalements vérifiés. Les
        défauts non vérifiés n’entrent dans aucun total.
      </p>
    </div>
  );
}
