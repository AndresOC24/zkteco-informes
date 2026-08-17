import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

/* ---------- medición responsive ---------- */
export function useMeasure<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* ---------- tema ---------- */
export function useTheme(): ['light' | 'dark', () => void] {
  const read = (): 'light' | 'dark' => {
    const forced = document.documentElement.dataset.theme;
    if (forced === 'light' || forced === 'dark') return forced;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(read());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const toggle = () => {
    const next = read() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* sin storage */ }
    setTheme(next);
  };
  return [theme, toggle];
}

/* ---------- escala "bonita" para ejes ---------- */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const s = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return s * p;
}

/** Rect con extremo de dato redondeado (4px) y base cuadrada, creciendo hacia arriba */
export function roundedTopRect(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Rect horizontal con extremo derecho redondeado y base (izquierda) cuadrada */
export function roundedRightRect(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, h / 2, w);
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}

/* ---------- tooltip ---------- */
export interface TTRow {
  color?: string;
  label: string;
  value: string;
}

export interface TTState {
  x: number;
  y: number;
  title: string;
  rows: TTRow[];
}

export function ChartTooltip({ tt, width }: { tt: TTState | null; width: number }) {
  const last = useRef<TTState | null>(null);
  if (tt) last.current = tt;
  const shown = tt ?? last.current;
  if (!shown) return null;
  const ttWidth = 150;
  const left = Math.max(0, Math.min(shown.x + 14, width - ttWidth));
  const top = Math.max(0, shown.y - 8);
  return (
    <div className={`tooltip${tt ? ' visible' : ''}`} style={{ left, top }}>
      <div className="tt-title">{shown.title}</div>
      {shown.rows.map((r, i) => (
        <div className="tt-row" key={i}>
          {r.color && <span className="tt-key" style={{ background: r.color }} />}
          <span className="tt-value">{r.value}</span>
          <span className="tt-label">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- tarjeta con alternancia gráfico/tabla ---------- */
export interface TableSpec {
  head: string[];
  rows: (string | number)[][];
  /** índices de columnas numéricas (alineadas a la derecha, tabular-nums) */
  numCols?: number[];
}

interface ChartCardProps {
  title: string;
  sub?: string;
  span: 4 | 6 | 8 | 12;
  legend?: { label: string; color: string; shape: 'rect' | 'line' }[];
  table: TableSpec;
  children: ReactNode;
}

const IconTable = (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M1.5 3.5h12M1.5 7.5h12M1.5 11.5h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const IconChart = (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path d="M2.5 12.5v-4M7.5 12.5v-8M12.5 12.5v-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export function ChartCard({ title, sub, span, legend, table, children }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card span-${span}`}>
      <div className="chart-head">
        <div>
          <h2 className="chart-title">{title}</h2>
          {sub && <p className="chart-sub">{sub}</p>}
        </div>
        <div className="chart-actions">
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowTable((v) => !v)}
            title={showTable ? 'Ver gráfico' : 'Ver tabla'}
            aria-label={showTable ? 'Ver gráfico' : 'Ver tabla de datos'}
          >
            {showTable ? IconChart : IconTable}
          </button>
        </div>
      </div>
      {!showTable && legend && legend.length > 1 && (
        <div className="legend">
          {legend.map((l) => (
            <span className="legend-item" key={l.label}>
              <span
                className={l.shape === 'line' ? 'legend-line' : 'legend-swatch'}
                style={{ background: l.color }}
              />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {showTable ? (
        <div className="table-view">
          <table className="data-table">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={i} className={table.numCols?.includes(i) ? 'num' : undefined}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={table.numCols?.includes(ci) ? 'num' : undefined}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
