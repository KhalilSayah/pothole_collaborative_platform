# Route Tlemcen — collecte collaborative

Waze-style pothole collection. Phone-first, landscape-optimised, offline-capable,
anonymous. React + Vite, deploys to Vercel, backed by Supabase.

```bash
npm install
npm run dev -- --host      # then open on the phone over the LAN
```

---

## The data format

This is the part that makes everything else possible. Three collection methods
produce **one record shape**, so they can be fused without special-casing.

### Two layers, deliberately separated

**`observations`** — raw, append-only, never edited. Every signal any device ever
produced, exactly as measured. Immutable.

**`clusters`** — derived, disposable. One row per physical pothole, fused across
methods and rides. This is the public map. It can be **rebuilt from scratch** at
any time by re-running the fusion.

That split is the whole design. If the clustering radius turns out to be wrong,
or the accelerometer thresholds need retuning, nothing is lost — recompute and
the map improves. Had we fused on write, every early mistake would be permanent.

### One shape for all three methods

| field | camera | accel | manual |
|---|---|---|---|
| `lat/lon`, `gps_accuracy_m`, `speed_mps`, `heading_deg` | ✓ | ✓ | ✓ |
| `t_offset_ms` (ms since ride start) | ✓ | ✓ | ✓ |
| `severity`, `damage_type`, `confidence` | ✓ | ✓ | ✓ |
| `corrected_lat/lon` | — | — | ✓ reaction lag |
| `payload` (method-specific JSON) | area_m², bbox | waveform, peak_g, z | reaction_lag_s |

`t_offset_ms` rather than wall-clock is the authoritative within-ride timeline —
it survives a device clock change mid-journey.

### Fusing one ride

A single pothole often fires the accelerometer **and** gets tapped a second later.
Without fusion it would be counted twice and look twice as bad.

`fuse_ride()` links observations within 20 m and a **−1 s … +6 s** window. The
window is asymmetric on purpose: a manual tap always *follows* the impact.

**The correction that matters most:** a driver taps *after* passing the pothole.
At 50 km/h a 1.4 s reaction puts the report **~19 m downstream** — larger than GPS
error itself. So manual reports are back-projected along the recorded track by
`lag × speed`. `lat/lon` keeps what the sensor said; `corrected_lat/lon` holds the
best estimate. Following the actual track (not the instantaneous heading) keeps
this correct through corners.

### Fusing across rides

`attach_observation()` snaps each new observation to a cluster within ~12 m, or
starts one. The centroid is weighted by GPS accuracy, so a 3 m fix moves it more
than a 40 m fix.

Confidence rewards **independent corroboration**, not repetition:

```
0.35 × (distinct rides   / 4)     ← different journeys
0.40 × (distinct methods / 3)     ← accel AND manual agreeing
0.25 × (observations     / 8)     ← raw volume, weakest evidence
```

Ten accel hits in one ride is weak. One accel hit plus one manual report from two
different drivers is strong. A cluster becomes `confirmed` at ≥2 rides or ≥2
methods.

**Severity** takes `max()` — the enum is ordered `low < medium < high`, and
under-reporting damage is the costlier error. **Damage type** trusts humans over
sensors.

---

## Method 2 — the accelerometer

### Mounting is a hard gate

A phone in a mount sits at an arbitrary angle, so its Z axis is **not** vertical.
Raw axis readings are meaningless alone. Recording cannot start until:

1. the phone is fixed in its holder,
2. the vehicle is stationary,
3. a 4 s calibration measures the gravity vector.

Calibration is **rejected** if the phone wobbles more than 6°, or if gravity does
not read ~1 g. A wrong "down" makes every later measurement wrong in a way that
looks perfectly plausible in the data — which is exactly why it must fail loudly.

During the ride, orientation is tracked with a ~2 s filter (far too slow to
absorb a ~100 ms impact). Drift past 25° raises **mount lost** rather than
emitting bad severity numbers.

### The threshold adapts

A fixed threshold cannot work — smooth asphalt, cobbles, an old Peugeot and a new
SUV all have different vibration floors. The detector continuously estimates the
current road's own noise and fires at **4.5σ** above it, so it recalibrates to
whatever surface it is on. The estimate **freezes during an event**, so a violent
impact cannot inflate the baseline and mask the potholes right after it.

### Features extracted

- **Leading sign** — the first excursion out of the noise. Wheel *drops* first
  (pothole) vs *rises* first (speed bump). Taken from the first break, not the
  largest swing, which is often the rebound and has the opposite sign.
- **Rear-axle confirmation** — the back wheel hits the same hole one wheelbase
  later. A second peak at exactly `wheelbase / speed` is hard to fake.
- **Speed normalisation** — the same hole at 90 km/h jolts far harder than at
  18 km/h. Severity divides peak by speed, so it measures the *hole*, not the
  driving.
- **Speed gate** — below 11 km/h everything is ignored; door slams dominate.

### Measured on simulated signals

`npx esbuild /tmp/dettest.ts --bundle --platform=node --outfile=/tmp/t.cjs && node /tmp/t.cjs`

| test | result |
|---|---|
| gravity recovery (22° tilt) | 9.808 vs 9.807 m/s² |
| detection, smooth → cobbled | 3/3, 3/3, 3/3 |
| **false positives, 75 s of noise** | **0** |
| pothole vs speed bump | 3/3 both ways |
| rear-axle confirmation | 3/3 correct, 0 false |
| speed invariance (18→90 km/h) | index 0.36 / 0.34 / 0.34 |
| severity separation | 0.15 low · 0.33 medium · 0.58 high |

These are *simulated* signals. Real vehicles will differ — which is what training
mode exists to measure.

---

## Training mode

Instead of "was that a pothole?", the driver names the class:

**nid-de-poule · dos d'âne · freinage · route normale · plaque · autre**

Multi-class matters: the hard cases are speed bumps and heavy braking, which look
similar in peak magnitude and differ in shape. A model can only learn that
boundary if the labels draw it.

Two things change in training mode:

1. **Threshold drops to 2.5σ.** A model trained only on events that already
   passed a strict gate never sees the boundary it must draw — every example is
   an easy one.
2. **Forced negatives.** Every ~40 s a window of ordinary road is captured even
   though nothing triggered. Without these the dataset contains only jolts, and a
   classifier would never learn what *normal* looks like.

Measured over a simulated 5-minute drive:

| | production | training |
|---|---|---|
| triggered events | 9 | 15 |
| forced negatives | 0 | 8 |
| **total labellable** | **9** | **23** |
| peak range | 0.19–0.58 g | 0.09–0.60 g |

Labelling a jolt as *braking* or *normal road* sets its confidence to 0, so it can
never reach the public map. Without that, every hard brake would become a
permanent fake pothole.

**`dismissed` is missing data, not a negative.** An unanswered prompt is excluded
from the training view — recording it as "not a pothole" would teach a model that
real potholes are not potholes.

Export via **Réglages → Exporter le jeu de données (CSV)**, or read the
`accel_training_set` view in Supabase. Nothing here trains a model; it only
collects.

---

## Method 1 — camera

Shown greyed out, labelled *Avancé*. It needs video processing that does not
belong on a phone in a moving car. The Python pipeline in `../pothole/` handles
it, and writes into the same `observations` table.

Supabase Storage holds the crops: bucket `pothole-images`, anon insert only, no
listing, no deletion. Path goes in `observations.image_path`.

---

## Setup

### Supabase

**The database starts empty — the tables do not create themselves.** Until the
schema is applied, every insert from the app fails.

1. Create a project. **Settings → API** gives the URL and the **anon** key.
2. **SQL Editor → New query →** paste all of `supabase/schema.sql` → Run.
   It enables PostGIS, creates the tables, RLS policies, grants, fusion
   functions and the training view.
3. Paste and run `supabase/verify.sql`. It inserts an accelerometer hit and a
   manual report 5 m apart and asserts they fused into one cluster, then cleans
   up. If it prints `ALL CHECKS PASSED`, the backend is working end to end.
4. Create the storage bucket (SQL at the bottom of the schema file) — only
   needed for method 1 images.

```bash
cp .env.example .env
# VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

Use the **anon** key, never `service_role` — this is a client app and everything
here ships to every browser. RLS is what protects the data.

**Session-pooler credentials are for server-side Postgres connections and will
not work here.** The browser talks to the REST API with the anon key.

### Vercel

```bash
npx vercel
```

Add the two env vars in the dashboard. `vercel.json` already sets the
`Permissions-Policy` header that accelerometer and geolocation need.

### HTTPS is mandatory

iOS releases motion and location only in a secure context. `npm run dev` over
plain HTTP on the LAN **will not work on an iPhone** — deploy to Vercel, or
tunnel (`npx localtunnel --port 5173`) to test on a real phone.

---

## Privacy

No account, no login, no device fingerprint. A ride is a random UUID generated on
the device and never linked to anything persistent — two rides by the same driver
are not connectable by design.

Anonymous clients may **insert** but may **not read** `observations`. Raw rows are
a full journey trace; letting anyone read them would let them follow an individual
trip even without a name attached. The public map reads `clusters`, which is
aggregated and unlinkable.

---

## Offline

Everything is written to IndexedDB **first**, uploaded after. Nothing leaves the
queue until the server confirms it. Duplicate-key errors are treated as success —
the row arrived, only the acknowledgement was lost.

With no Supabase credentials the app still works completely: rides accumulate
locally and export as JSON/CSV. You can run a real drive before any backend
exists.

---

## Files

| path | role |
|---|---|
| `supabase/schema.sql` | tables, RLS, fusion, training view |
| `src/lib/accel.ts` | detector: calibration, adaptive threshold, features |
| `src/lib/ride.ts` | ride lifecycle, GPS, observation log |
| `src/lib/geo.ts` | reaction-lag back-projection |
| `src/lib/queue.ts` / `sync.ts` | offline queue, upload, CSV export |
| `src/lib/labels.ts` | training label taxonomy |
| `src/screens/Report.tsx` | method 3 — the landscape card grid |
| `src/components/TrainingPrompt.tsx` | multi-class labelling |

## Known limits

- **Detector validated on simulated signals only.** Real suspensions, mounts and
  road surfaces will differ. Collect with training mode before trusting the
  thresholds.
- **Severity is a proxy.** Vertical acceleration measures how hard the *car* was
  hit, not the hole's depth. Speed normalisation helps; it is not a depth sensor.
- **GPS error ~5 m** sets the dedup floor. Two real potholes closer than the
  cluster radius will merge.
- **The SQL is parse-validated, not execution-tested.** No PostGIS server was
  available locally, so the schema was checked against the real PostgreSQL
  grammar (`pglast`) and reviewed by hand. Four genuine bugs were found that
  way: a self-referencing CTE missing `WITH RECURSIVE`; fusion functions that
  RLS would have blocked without `SECURITY DEFINER`; a `GRANT` on a view before
  the view existed; and unqualified PostGIS calls that fail because Supabase
  installs the extension into the `extensions` schema. Run `verify.sql` to
  confirm the rest.
