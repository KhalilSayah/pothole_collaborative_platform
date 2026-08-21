// Small SVG chart primitives.
//
// Hand-rolled rather than pulled from a library: these are three simple forms,
// and a charting dependency would weigh more than the whole admin bundle while
// giving less control over the mark specs than this does.

import { useState, type ReactNode } from 'react';
import { INK, fmt } from '../../lib/viz';

export function Frame({ title, sub, right, children, note }: {
  title: string; sub?: string; right?: ReactNode; children: ReactNode; note?: string;
}) {
  return (
    <section className="chart">
      <header className="chart-h">
        <div>
          <h3>{title}</h3>
          {sub && <p className="small muted">{sub}</p>}
        </div>
        {right}
      </header>
      {children}
      {note && <p className="chart-note">{note}</p>}
    </section>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="legend">
      {items.map(i => (
        <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ lines */
export interface Serie { label: string; color: string; values: number[]; }

export function LineChart({ labels, series, height = 210 }: {
  labels: string[]; series: Serie[]; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, P = { t: 14, r: 14, b: 32, l: 46 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap(s => s.values));

  const x = (i: number) => P.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => P.t + ih - (v / max) * ih;
  const ticks = [...new Set([0, Math.round(max / 2), max])];

  return (
    <div className="chart-svg">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           onMouseLeave={() => setHover(null)}
           onMouseMove={e => {
             const svg = e.currentTarget;
             const r = svg.getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * W;
             setHover(Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / iw) * (n - 1)))));
           }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize={14} fill={INK.muted}>{t}</text>
          </g>
        ))}

        {series.map(s => (
          <path key={s.label} fill="none" stroke={s.color} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round"
                d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} />
        ))}

        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih}
                  stroke={INK.axis} strokeWidth={1} strokeDasharray="3 3" />
            {series.map(s => (
              /* 2px surface ring keeps overlapping markers separable. */
              <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r={4.5}
                      fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </>
        )}

        {[0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i, k, a) => (
          <text key={i} x={x(i)} y={H - 7}
                textAnchor={k === 0 ? 'start' : k === a.length - 1 ? 'end' : 'middle'}
                fontSize={14} fill={INK.muted}>{labels[i]}</text>
        ))}
      </svg>

      {hover !== null && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{labels[hover]}</b>
          {series.map(s => (
            <span key={s.label}>
              <i style={{ background: s.color }} />{s.label} <b>{fmt(s.values[hover])}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- bars */
export function BarChart({ rows, height = 200 }: {
  rows: { label: string; value: number; color: string }[]; height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map(r => r.value));
  const W = 720, H = height, P = { t: 30, r: 12, b: 34, l: 12 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const bw = iw / Math.max(1, rows.length);

  return (
    <div className="chart-svg">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {rows.map((r, i) => {
          const h = Math.max(4, (r.value / max) * ih);
          const w = bw - 6;                       // 2px+ gap between fills
          const x0 = P.l + i * bw + 3;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={P.l + i * bw} y={P.t} width={bw} height={ih} fill="transparent" />
              {/* 4px rounded top, anchored to the baseline so the mark reads
                  as growing from zero. */}
              <path d={`M${x0},${P.t + ih} v${-(h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${h - 4} z`}
                    fill={r.color} opacity={hover === null || hover === i ? 1 : 0.45} />
              {/* Fills sit under 3:1 on white, so the value is always written
                  out rather than left to the colour alone. */}
              <text x={x0 + w / 2} y={P.t + ih - h - 8} textAnchor="middle"
                    fontSize={16} fontWeight={700} fill={INK.primary}>{fmt(r.value)}</text>
              <text x={x0 + w / 2} y={H - 9} textAnchor="middle"
                    fontSize={14} fill={INK.muted}>{r.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------------------------------------------- horizontal bars */
export function RankChart({ rows, unit = '' }: {
  rows: { label: string; value: number; color: string }[]; unit?: string;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="rank">
      {rows.map(r => (
        <div className="rank-row" key={r.label}>
          <div className="rank-label" title={r.label}>{r.label}</div>
          <div className="rank-track">
            <div className="rank-fill"
                 style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color }} />
          </div>
          <div className="rank-val">{fmt(r.value)}{unit}</div>
        </div>
      ))}
    </div>
  );
}
