import MapView from '../components/MapView';
import Reveal from '../components/Reveal';
import Counter from '../components/Counter';
import type { Cluster } from '../lib/types';

const METHODS = [
  {
    n: '01', icon: '👆', title: 'Signalement direct',
    body: "Au volant, une grille de cartes en plein écran : un appui suffit. La position est recalée en arrière pour compenser le temps de réaction — à 50 km/h, une seconde et demie représente vingt mètres.",
    tag: null,
  },
  {
    n: '02', icon: '📳', title: 'Détection automatique',
    body: "L’accéléromètre du téléphone repère les chocs pendant que vous conduisez. Le seuil s’ajuste en continu à la rugosité de la route, et la roue arrière sert de confirmation.",
    tag: null,
  },
  {
    n: '03', icon: '📷', title: 'Photo depuis le trottoir',
    body: "À pied, une photo et deux appuis suffisent. Chaque cliché passe par une vérification avant d’apparaître sur la carte.",
    tag: null,
  },
  {
    n: '04', icon: '🎥', title: 'Caméra embarquée',
    body: "Analyse vidéo d’un trajet complet par un modèle de segmentation, avec mesure de la surface au sol. Traitement lourd, réservé aux contributeurs équipés.",
    tag: 'Avancé',
  },
];

export default function Home({ rows, loading }: { rows: Cluster[]; loading: boolean }) {
  const high = rows.filter(r => r.severity === 'high').length;
  const confirmed = rows.filter(r => r.status === 'confirmed').length;
  const roads = new Set(rows.map(r => r.road_name).filter(Boolean)).size;

  return (
    <>
      {/* ------------------------------------------------------- hero */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div>
              <Reveal>
                <span className="pill"><i className="dot" />Projet ouvert · Tlemcen</span>
              </Reveal>
              <Reveal delay={1}>
                <h1 style={{ marginTop: 22 }}>
                  Cartographier les routes,<br />
                  <span style={{
                    background: 'linear-gradient(135deg,#0d9488,#0891b2)',
                    WebkitBackgroundClip: 'text', backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}>ensemble</span>.
                </h1>
              </Reveal>
              <Reveal delay={2}>
                <p className="lede">
                  Une plateforme collaborative de signalement des dégradations
                  routières. Chacun contribue depuis son téléphone — en voiture ou
                  à pied — et les relevés se combinent en une carte partagée.
                </p>
              </Reveal>
              <Reveal delay={3}>
                <div className="hero-cta">
                  <a className="btn lg" href="#/signaler">Signaler un défaut</a>
                  <a className="btn lg ghost" href="#/carte">Explorer la carte</a>
                </div>
              </Reveal>
              <Reveal delay={4}>
                <p className="small muted" style={{ marginTop: 20 }}>
                  Sans compte, sans inscription, entièrement anonyme.
                </p>
              </Reveal>
            </div>

            <Reveal delay={2}>
              <MapView rows={rows} height="hero" showStats={!loading} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- numbers */}
      <section className="sec">
        <div className="wrap">
          <div className="grid g4 center">
            {[
              { v: rows.length, l: 'Défauts cartographiés' },
              { v: high, l: 'Signalés comme graves' },
              { v: confirmed, l: 'Confirmés par recoupement' },
              { v: roads, l: 'Rues concernées' },
            ].map((s, i) => (
              <Reveal key={s.l} className="stat" delay={(i + 1) as 1 | 2 | 3 | 4}>
                <b><Counter to={s.v} /></b>
                <span>{s.l}</span>
              </Reveal>
            ))}
          </div>
          {!loading && rows.length === 0 && (
            <Reveal className="center">
              <div className="note" style={{ display: 'inline-flex', marginTop: 28 }}>
                <span>🗺️</span>
                <span>Aucun relevé pour l’instant — la carte se remplira dès les premiers signalements.</span>
              </div>
            </Reveal>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------- methods */}
      <section className="sec tint" id="methodes">
        <div className="wrap">
          <Reveal className="sec-head center">
            <div className="eyebrow">Comment ça marche</div>
            <h2>Quatre façons de contribuer</h2>
            <p className="lede" style={{ marginTop: 16 }}>
              Chaque méthode a ses forces et ses angles morts. C’est en les
              croisant qu’on obtient une carte fiable plutôt qu’une liste
              d’impressions.
            </p>
          </Reveal>

          <div className="grid g2">
            {METHODS.map((m, i) => (
              <Reveal key={m.n} delay={((i % 2) + 1) as 1 | 2}>
                <article className={'card hov step' + (m.tag ? ' off' : '')}>
                  <span className="n">{m.n}</span>
                  <div className="ic">{m.icon}</div>
                  <h3>
                    {m.title}
                    {m.tag && <span className="tag">{m.tag}</span>}
                  </h3>
                  <p>{m.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- trust */}
      <section className="sec">
        <div className="wrap">
          <Reveal className="sec-head center">
            <div className="eyebrow">Fiabilité</div>
            <h2>Pourquoi cette carte est crédible</h2>
          </Reveal>

          <div className="grid g3">
            {[
              {
                i: '🔎', t: 'Chaque photo est vérifiée',
                b: "Un signalement photo n’apparaît pas immédiatement. Il est d’abord contrôlé, et rejeté s’il ne montre pas de dégradation réelle. Sans ce filtre, n’importe qui pourrait inventer des dizaines de nids-de-poule.",
              },
              {
                i: '🔗', t: 'La corroboration prime',
                b: "Un défaut vu dix fois pendant un seul trajet reste une preuve faible. Deux passages indépendants, ou deux méthodes qui concordent, valent bien davantage — et c’est ce que mesure l’indice de fiabilité.",
              },
              {
                i: '🕵️', t: 'Aucune donnée personnelle',
                b: "Ni compte, ni identifiant d’appareil. Chaque trajet reçoit un numéro aléatoire, impossible à relier aux précédents. Les traces brutes ne sont jamais lisibles publiquement.",
              },
            ].map((c, i) => (
              <Reveal key={c.t} delay={((i % 3) + 1) as 1 | 2 | 3}>
                <article className="card hov">
                  <div className="ic">{c.i}</div>
                  <h3>{c.t}</h3>
                  <p>{c.b}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- cta */}
      <section className="sec" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <Reveal>
            <div className="band">
              <h2>Un trajet suffit pour commencer</h2>
              <p>
                Fixez le téléphone, lancez l’enregistrement, conduisez normalement.
                Ou signalez simplement le nid-de-poule devant chez vous.
              </p>
              <div className="row" style={{ justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
                <a className="btn lg ghost" href="#/signaler">Signaler à pied</a>
                <a className="btn lg dark" href="#/conduire">Mode conduite</a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
