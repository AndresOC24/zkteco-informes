import { useMemo, useState, type CSSProperties } from 'react';
import type { DailyPoint, DeptStat, DeviceStat } from '../lib/stats';
import { fmtInt, fmtPct, fmtFecha, fmtFechaCorta, DIAS_SEMANA } from '../lib/format';
import { CARRERAS } from '../lib/carreras';
import {
  useMeasure, niceMax, roundedTopRect, roundedRightRect,
  ChartTooltip, type TTState,
} from './chartCore';

/* Márgenes comunes: eje Y a la izquierda, banda de etiquetas X abajo */
const M = { top: 10, right: 12, bottom: 24, left: 44 };

const tickStyle: CSSProperties = { fontSize: 11, fill: 'var(--muted)' };
const labelStyle: CSSProperties = { fontSize: 11, fill: 'var(--text-2)', fontWeight: 600 };

function YGrid({ max, innerW, innerH }: { max: number; innerW: number; innerH: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <g>
      {ticks.map((v, i) => {
        const y = M.top + innerH - (v / max) * innerH;
        return (
          <g key={i}>
            <line
              x1={M.left} x2={M.left + innerW} y1={y} y2={y}
              stroke={i === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={M.left - 8} y={y + 3.5} textAnchor="end" style={{ ...tickStyle, fontVariantNumeric: 'tabular-nums' }}>
              {fmtInt(v)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ============================================================
   Columnas diarias (una serie)
   ============================================================ */
export function DailyColumns({
  data, color, valueLabel, height = 210,
}: {
  data: DailyPoint[];
  color: string;
  /** selector del valor + etiqueta del tooltip, p.ej. ['personas', 'personas únicas'] */
  valueLabel: [keyof DailyPoint & ('personas' | 'entradas' | 'salidas' | 'intentosBloqueados'), string];
  height?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);
  const [hover, setHover] = useState(-1);
  const [field, label] = valueLabel;

  const values = data.map((d) => d[field] as number);
  const max = niceMax(Math.max(1, ...values));
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const step = data.length > 0 ? innerW / data.length : 0;
  const barW = Math.min(24, Math.max(3, step - 2));
  const peakIdx = values.indexOf(Math.max(...values));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(innerW / 52))));

  return (
    <div className="chart-body" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label={label}>
          <YGrid max={max} innerW={innerW} innerH={innerH} />
          {data.map((d, i) => {
            const v = values[i];
            const h = (v / max) * innerH;
            const x = M.left + i * step + (step - barW) / 2;
            const y = M.top + innerH - h;
            return (
              <path
                key={d.key}
                d={roundedTopRect(x, y, barW, Math.max(h, v > 0 ? 2 : 0))}
                fill={color}
                style={{ filter: hover === i ? 'brightness(1.15)' : undefined }}
              />
            );
          })}
          {/* etiqueta directa solo en el pico */}
          {peakIdx >= 0 && values[peakIdx] > 0 && (
            <text
              x={M.left + peakIdx * step + step / 2}
              y={M.top + innerH - (values[peakIdx] / max) * innerH - 6}
              textAnchor="middle" style={labelStyle}
            >
              {fmtInt(values[peakIdx])}
            </text>
          )}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text
                key={d.key}
                x={M.left + i * step + step / 2}
                y={height - 6}
                textAnchor="middle"
                style={tickStyle}
              >
                {fmtFechaCorta(d.date)}
              </text>
            ) : null,
          )}
          {/* zonas de hover: banda completa por columna */}
          {data.map((d, i) => (
            <rect
              key={d.key}
              x={M.left + i * step} y={M.top} width={step} height={innerH}
              fill="transparent"
              onPointerMove={(e) => {
                const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setHover(i);
                setTt({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  title: fmtFecha(d.date),
                  rows: [{ color, label, value: fmtInt(values[i]) }],
                });
              }}
              onPointerLeave={() => { setHover(-1); setTt(null); }}
            />
          ))}
        </svg>
      )}
      <ChartTooltip tt={tt} width={width} />
    </div>
  );
}

/* ============================================================
   Líneas múltiples con crosshair (flujo entradas vs salidas)
   ============================================================ */
export function FlowLines({ data, height = 230 }: { data: DailyPoint[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);
  const [hoverIdx, setHoverIdx] = useState(-1);

  const series = [
    { name: 'Entradas', color: 'var(--series-1)', values: data.map((d) => d.entradas) },
    { name: 'Salidas', color: 'var(--series-2)', values: data.map((d) => d.salidas) },
  ];
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const xAt = (i: number) => M.left + (data.length > 1 ? (i / (data.length - 1)) * innerW : innerW / 2);
  const yAt = (v: number) => M.top + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(innerW / 52))));

  return (
    <div className="chart-body" ref={ref}>
      {width > 0 && data.length > 0 && (
        <svg height={height} role="img" aria-label="Pasadas de entrada y salida por día">
          <YGrid max={max} innerW={innerW} innerH={innerH} />
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.key} x={xAt(i)} y={height - 6} textAnchor="middle" style={tickStyle}>
                {fmtFechaCorta(d.date)}
              </text>
            ) : null,
          )}
          {hoverIdx >= 0 && (
            <line
              x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={M.top} y2={M.top + innerH}
              stroke="var(--axis)" strokeWidth={1}
            />
          )}
          {series.map((s) => (
            <polyline
              key={s.name}
              points={s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
            />
          ))}
          {/* marcadores en el índice bajo el cursor, con anillo de superficie */}
          {hoverIdx >= 0 &&
            series.map((s) => (
              <circle
                key={s.name}
                cx={xAt(hoverIdx)} cy={yAt(s.values[hoverIdx])} r={4.5}
                fill={s.color} stroke="var(--surface)" strokeWidth={2}
              />
            ))}
          <rect
            x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent"
            onPointerMove={(e) => {
              const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              const px = e.clientX - rect.left;
              const i = Math.round(((px - M.left) / Math.max(innerW, 1)) * (data.length - 1));
              const idx = Math.max(0, Math.min(data.length - 1, i));
              setHoverIdx(idx);
              setTt({
                x: xAt(idx),
                y: e.clientY - rect.top,
                title: fmtFecha(data[idx].date),
                rows: series.map((s) => ({ color: s.color, label: s.name.toLowerCase(), value: fmtInt(s.values[idx]) })),
              });
            }}
            onPointerLeave={() => { setHoverIdx(-1); setTt(null); }}
          />
        </svg>
      )}
      <ChartTooltip tt={tt} width={width} />
    </div>
  );
}

/* ============================================================
   Heatmap hora × día de la semana
   ============================================================ */
const RAMP_LIGHT = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const RAMP_DARK = [...RAMP_LIGHT].reverse();

export function HourHeatmap({ matrix, max, theme }: { matrix: number[][]; max: number; theme: 'light' | 'dark' }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);

  const left = 36;
  const cellH = 22;
  const cellW = Math.max(4, (width - left) / 24);
  const height = 7 * cellH + 22;
  const ramp = theme === 'dark' ? RAMP_DARK : RAMP_LIGHT;

  const colorFor = (v: number): string => {
    if (v <= 0 || max <= 0) return 'var(--page)';
    const idx = Math.min(ramp.length - 1, Math.floor(Math.sqrt(v / max) * ramp.length));
    return ramp[idx];
  };

  return (
    <div className="chart-body" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label="Entradas por hora y día de la semana">
          {matrix.map((row, d) => (
            <g key={d}>
              <text x={left - 8} y={d * cellH + cellH / 2 + 4} textAnchor="end" style={tickStyle}>
                {DIAS_SEMANA[d]}
              </text>
              {row.map((v, h) => (
                <rect
                  key={h}
                  x={left + h * cellW + 1} y={d * cellH + 1}
                  width={Math.max(1, cellW - 2)} height={cellH - 2}
                  rx={3}
                  fill={colorFor(v)}
                  stroke={hover?.[0] === d && hover?.[1] === h ? 'var(--text-1)' : 'none'}
                  strokeWidth={1.25}
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover([d, h]);
                    setTt({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                      title: `${DIAS_SEMANA[d]} · ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`,
                      rows: [{ label: 'entradas', value: fmtInt(v) }],
                    });
                  }}
                  onPointerLeave={() => { setHover(null); setTt(null); }}
                />
              ))}
            </g>
          ))}
          {Array.from({ length: 24 }, (_, h) =>
            h % 3 === 0 ? (
              <text key={h} x={left + h * cellW + cellW / 2} y={height - 5} textAnchor="middle" style={tickStyle}>
                {String(h).padStart(2, '0')}
              </text>
            ) : null,
          )}
        </svg>
      )}
      <ChartTooltip tt={tt} width={width} />
    </div>
  );
}

/* ============================================================
   Barras horizontales: % de bloqueados por carrera (una serie)
   ============================================================ */
export function DeptBlockedBars({ stats }: { stats: DeptStat[] }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);
  const [hover, setHover] = useState(-1);

  const rows = stats.filter((s) => s.bloqueadas > 0);
  const labelW = 52;
  const valueW = 52;
  const rowH = 26;
  const barH = 14;
  const height = rows.length * rowH;
  const innerW = Math.max(10, width - labelW - valueW);
  const max = Math.max(1, ...rows.map((r) => r.pct));

  return (
    <div className="chart-body" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label="Porcentaje de personas bloqueadas por carrera">
          {rows.map((r, i) => {
            const w = Math.max(2, (r.pct / max) * innerW);
            const y = i * rowH + (rowH - barH) / 2;
            return (
              <g key={r.name}>
                <text x={labelW - 8} y={i * rowH + rowH / 2 + 4} textAnchor="end" style={{ ...tickStyle, fill: 'var(--text-2)' }}>
                  {r.name}
                </text>
                <path
                  d={roundedRightRect(labelW, y, w, barH)}
                  fill="var(--series-1)"
                  style={{ filter: hover === i ? 'brightness(1.15)' : undefined }}
                />
                <text
                  x={labelW + w + 7} y={i * rowH + rowH / 2 + 4}
                  style={{ ...tickStyle, fill: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtPct(r.pct)}
                </text>
                <rect
                  x={0} y={i * rowH} width={width} height={rowH} fill="transparent"
                  onPointerMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover(i);
                    setTt({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                      title: CARRERAS[r.name] ?? r.name,
                      rows: [
                        { color: 'var(--series-1)', label: `de ${fmtInt(r.personas)} personas`, value: fmtInt(r.bloqueadas) },
                        { label: 'bloqueadas', value: fmtPct(r.pct) },
                      ],
                    });
                  }}
                  onPointerLeave={() => { setHover(-1); setTt(null); }}
                />
              </g>
            );
          })}
        </svg>
      )}
      <ChartTooltip tt={tt} width={width} />
    </div>
  );
}

/* ============================================================
   Barras agrupadas por molinete: entradas vs salidas
   ============================================================ */
export function DeviceBars({ stats }: { stats: DeviceStat[] }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);

  const rows = stats.filter((s) => s.entradas + s.salidas > 0);
  const labelW = 104;
  const valueW = 56;
  const barH = 13;
  const groupH = 42;
  const height = rows.length * groupH;
  const innerW = Math.max(10, width - labelW - valueW);
  const max = Math.max(1, ...rows.flatMap((r) => [r.entradas, r.salidas]));

  const bars: { color: string; label: string; value: (r: DeviceStat) => number }[] = [
    { color: 'var(--series-1)', label: 'entradas', value: (r) => r.entradas },
    { color: 'var(--series-2)', label: 'salidas', value: (r) => r.salidas },
  ];

  return (
    <div className="chart-body" ref={ref}>
      {width > 0 && (
        <svg height={height} role="img" aria-label="Entradas y salidas por molinete">
          {rows.map((r, i) => (
            <g key={r.name}>
              <text x={labelW - 10} y={i * groupH + groupH / 2 + 4} textAnchor="end" style={{ ...tickStyle, fill: 'var(--text-2)' }}>
                {r.name}
              </text>
              {bars.map((b, bi) => {
                const v = b.value(r);
                const w = Math.max(2, (v / max) * innerW);
                const y = i * groupH + 5 + bi * (barH + 2); /* separación de 2px entre barras contiguas */
                return (
                  <g key={b.label}>
                    <path d={roundedRightRect(labelW, y, w, barH)} fill={b.color} />
                    <text
                      x={labelW + w + 7} y={y + barH - 3}
                      style={{ ...tickStyle, fontVariantNumeric: 'tabular-nums' }}
                    >
                      {fmtInt(v)}
                    </text>
                  </g>
                );
              })}
              <rect
                x={0} y={i * groupH} width={width} height={groupH} fill="transparent"
                onPointerMove={(e) => {
                  const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                  setTt({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    title: `Molinete ${r.name}`,
                    rows: bars.map((b) => ({ color: b.color, label: b.label, value: fmtInt(b.value(r)) })),
                  });
                }}
                onPointerLeave={() => setTt(null)}
              />
            </g>
          ))}
        </svg>
      )}
      <ChartTooltip tt={tt} width={width} />
    </div>
  );
}

/* ============================================================
   Barra apilada 100%: modo de verificación
   ============================================================ */
export function VerModeBar({ modes }: { modes: { huella: number; tarjeta: number; otro: number } }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [tt, setTt] = useState<TTState | null>(null);

  const total = Math.max(1, modes.huella + modes.tarjeta + modes.otro);
  const segs = [
    { label: 'Solo huella', color: 'var(--series-1)', value: modes.huella },
    { label: 'Solo tarjeta', color: 'var(--series-2)', value: modes.tarjeta },
    { label: 'Otro', color: 'var(--series-3)', value: modes.otro },
  ].filter((s) => s.value > 0);

  const barH = 30;
  const gap = 2;
  const height = barH;

  const segments = useMemo(() => {
    let x = 0;
    return segs.map((s) => {
      const w = (s.value / total) * Math.max(width, 1);
      const seg = { ...s, x, w };
      x += w;
      return seg;
    });
  }, [segs, total, width]);

  return (
    <div>
      <div className="chart-body" ref={ref}>
        {width > 0 && (
          <svg height={height} role="img" aria-label="Distribución del modo de verificación">
            {segments.map((s, i) => {
              const pct = (s.value / total) * 100;
              const label = fmtPct(pct);
              /* etiqueta dentro del segmento solo si cabe con holgura (~9px por carácter + padding) */
              const fits = s.w - gap > label.length * 9 + 16;
              return (
                <g key={s.label}>
                  <rect
                    x={s.x + (i > 0 ? gap : 0)} y={0}
                    width={Math.max(1, s.w - (i > 0 ? gap : 0))} height={barH}
                    rx={5} fill={s.color}
                    onPointerMove={(e) => {
                      const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                      setTt({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        title: s.label,
                        rows: [
                          { color: s.color, label: 'verificaciones', value: fmtInt(s.value) },
                          { label: 'del total', value: fmtPct(pct) },
                        ],
                      });
                    }}
                    onPointerLeave={() => setTt(null)}
                  />
                  {fits && (
                    <text
                      x={s.x + s.w / 2} y={barH / 2 + 4} textAnchor="middle"
                      style={{ fontSize: 11.5, fontWeight: 600, fill: '#fff', pointerEvents: 'none' }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        <ChartTooltip tt={tt} width={width} />
      </div>
      <div className="legend" style={{ marginTop: 12, marginBottom: 0, flexDirection: 'column', gap: 6 }}>
        {segs.map((s) => (
          <span className="legend-item" key={s.label} style={{ justifyContent: 'space-between', width: '100%' }}>
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-1)', fontWeight: 550 }}>
              {fmtInt(s.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

