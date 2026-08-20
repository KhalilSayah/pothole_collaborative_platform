// Pedestrian reporting: stop, photograph, submit.
//
// Unlike the driving flow this user is stationary and unhurried, so the design
// can ask for a photo and a category. The photo is what makes anonymous
// reporting workable at all — it is the evidence the verification step checks,
// and without it any passer-by could invent potholes at will.

import { useRef, useState } from 'react';
import { CARDS } from '../lib/damage';
import type { DamageType, Severity } from '../lib/types';
import { shrink, locate } from '../lib/image';
import { uploadPhoto, isCloudEnabled } from '../lib/supabase';
import { enqueue } from '../lib/queue';
import { flush } from '../lib/sync';
import Reveal from '../components/Reveal';

const uuid = () =>
  crypto.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2);

type Stage = 'idle' | 'locating' | 'sending' | 'done' | 'error';

export default function PhotoReport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState<DamageType>('pothole');
  const [sev, setSev] = useState<Severity>('medium');
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setErr(null);
  }

  async function submit() {
    setErr(null);
    try {
      setStage('locating');
      const pos = await locate();

      setStage('sending');
      let image_path: string | null = null;
      if (file && isCloudEnabled()) {
        const small = await shrink(file);
        image_path = await uploadPhoto(small, `${uuid()}.jpg`);
      }

      // A pedestrian report has no ride: it is a single standing observation.
      // A throwaway ride row keeps the foreign key honest without inventing a
      // journey that never happened.
      const ride_id = uuid();
      await enqueue('ride', {
        id: ride_id,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        platform: 'pedestrian',
        app_version: '1.0.0',
        detector_config: {},
      });

      await enqueue('observation', {
        id: uuid(),
        ride_id,
        method: 'photo',
        observed_at: new Date().toISOString(),
        t_offset_ms: 0,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        gps_accuracy_m: pos.coords.accuracy ?? null,
        // Standing still: no speed, no heading, nothing to back-project.
        speed_mps: null,
        heading_deg: null,
        corrected_lat: null,
        corrected_lon: null,
        position_correction_m: 0,
        damage_type: type,
        severity: sev,
        confidence: 0.5,          // provisional until verification
        payload: { source: 'pedestrian', has_photo: !!image_path },
        image_path,
        note: note.trim() || null,
      });

      await flush();
      setStage('done');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setStage('error');
    }
  }

  function reset() {
    setFile(null); setPreview(null); setNote('');
    setType('pothole'); setSev('medium'); setStage('idle'); setErr(null);
  }

  if (stage === 'done') {
    return (
      <div className="wrap sec">
        <Reveal className="narrow center">
          <div style={{ fontSize: 60 }}>✅</div>
          <h2 style={{ marginTop: 18 }}>Merci, c’est enregistré</h2>
          <p className="lede" style={{ marginTop: 14 }}>
            Votre signalement part en vérification. Une fois confirmé, il apparaît
            sur la carte publique.
          </p>
          <div className="note" style={{ marginTop: 26, textAlign: 'left' }}>
            <span>🔒</span>
            <span>
              Aucune donnée personnelle n’a été enregistrée : ni compte, ni identifiant
              d’appareil. Seuls la position du défaut et la photo ont été transmis.
            </span>
          </div>
          <div className="row" style={{ marginTop: 26, justifyContent: 'center' }}>
            <button className="btn" onClick={reset}>Signaler autre chose</button>
            <a className="btn ghost" href="#/carte">Voir la carte</a>
          </div>
        </Reveal>
      </div>
    );
  }

  const busy = stage === 'locating' || stage === 'sending';

  return (
    <div className="wrap sec">
      <Reveal className="narrow">
        <div className="eyebrow">Signalement piéton</div>
        <h2>Vous passez à côté d’un défaut&nbsp;?</h2>
        <p className="lede" style={{ marginTop: 14, marginBottom: 34 }}>
          Prenez une photo, choisissez le type, envoyez. Pas de compte, pas
          d’inscription — trente secondes.
        </p>

        <div className="field">
          <label>1 · La photo</label>
          {!preview ? (
            <>
              <button className="shot" style={{ width: '100%' }} onClick={() => input.current?.click()}>
                <div className="e">📷</div>
                <div style={{ fontWeight: 600, marginTop: 10 }}>Prendre une photo</div>
                <div className="small muted" style={{ marginTop: 4 }}>
                  Cadrez le défaut avec un peu de route autour
                </div>
              </button>
              <input
                ref={input} type="file" accept="image/*" capture="environment" hidden
                onChange={e => pick(e.target.files?.[0] ?? null)}
              />
            </>
          ) : (
            <div className="preview">
              <img src={preview} alt="Aperçu du signalement" />
              <button className="x" onClick={() => { setFile(null); setPreview(null); }}>✕</button>
            </div>
          )}
        </div>

        <div className="field">
          <label>2 · De quoi s’agit-il&nbsp;?</label>
          <div className="choices">
            {CARDS.map(c => (
              <button
                key={c.type}
                className={'choice' + (type === c.type ? ' on' : '')}
                onClick={() => setType(c.type)}
              >
                <span className="e">{c.icon}</span>
                <span className="t">{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>3 · Gravité</label>
          <div className="choices" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            {([['low', 'Léger', '🟢'], ['medium', 'Moyen', '🟠'], ['high', 'Grave', '🔴']] as const)
              .map(([k, t, e]) => (
                <button key={k} className={'choice' + (sev === k ? ' on' : '')}
                        onClick={() => setSev(k)}>
                  <span className="e">{e}</span><span className="t">{t}</span>
                </button>
              ))}
          </div>
        </div>

        <div className="field">
          <label>4 · Précision <span className="muted small">(facultatif)</span></label>
          <textarea
            rows={2} value={note} maxLength={280}
            placeholder="Ex. devant le n°12, côté droit en montant"
            onChange={e => setNote(e.target.value)}
          />
        </div>

        {!file && (
          <div className="note warn" style={{ marginBottom: 16 }}>
            <span>⚠️</span>
            <span>
              Sans photo, le signalement ne peut pas être vérifié et restera en
              attente. Ajoutez-en une pour qu’il apparaisse sur la carte.
            </span>
          </div>
        )}
        {err && <div className="note bad" style={{ marginBottom: 16 }}><span>✕</span><span>{err}</span></div>}

        <button className="btn lg block" disabled={busy} onClick={submit}>
          {busy && <span className="spin" />}
          {stage === 'locating' ? 'Localisation…'
            : stage === 'sending' ? 'Envoi…'
            : 'Envoyer le signalement'}
        </button>

        <p className="small muted center" style={{ marginTop: 16 }}>
          Votre position n’est relevée qu’au moment de l’envoi, et n’est reliée à
          aucun identifiant.
        </p>
      </Reveal>
    </div>
  );
}
