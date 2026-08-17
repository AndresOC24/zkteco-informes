import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Dataset } from './lib/types';
import { computeStats, type DateRange, type Grupo } from './lib/stats';
import { fmtInt, fmtPct, fmtFecha, fmtFechaCorta, fmtRango, DIAS_SEMANA } from './lib/format';
import { CARRERAS } from './lib/carreras';
import { loadDataset, saveDataset } from './lib/idb';
import { ChartCard, useTheme, type TableSpec } from './components/chartCore';
import {
  DailyColumns, FlowLines, HourHeatmap, DeptBlockedBars, DeviceBars, VerModeBar,
} from './components/charts';
import type { ParseResponse } from './worker/parseXls.worker';

const DAY = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' → epoch ms al inicio del día LOCAL (Date.parse lo tomaría como UTC) */
function parseDateInput(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}

/** epoch ms → 'YYYY-MM-DD' local, para <input type="date"> */
function toDateInput(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo>(() =>
    new URLSearchParams(location.search).get('grupo') === 'administrativos' ? 'administrativos' : 'estudiantes',
  );
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [exportando, setExportando] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  /* ---------- carga inicial: último dataset subido o el de ejemplo ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadDataset();
      if (cancelled) return;
      if (saved) {
        setDataset(saved);
        setIsDefault(false);
        return;
      }
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'default-data.json');
        if (!res.ok) throw new Error();
        const ds = (await res.json()) as Dataset;
        if (!cancelled) setDataset(ds);
      } catch {
        if (!cancelled) setError('No se pudo cargar el dataset de ejemplo. Sube un XLS para comenzar.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------- worker de parsing ---------- */
  const parseFile = useCallback((file: File) => {
    if (!/\.(xls|xlsx)$/i.test(file.name)) {
      setError(`"${file.name}" no es un archivo .xls/.xlsx`);
      return;
    }
    setError(null);
    setParsing(true);
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./worker/parseXls.worker.ts', import.meta.url), { type: 'module' });
    }
    const worker = workerRef.current;
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      setParsing(false);
      if (e.data.ok) {
        setDataset(e.data.dataset);
        setIsDefault(false);
        void saveDataset(e.data.dataset);
      } else {
        setError(`No se pudo procesar el archivo: ${e.data.error}`);
      }
    };
    file.arrayBuffer().then((buffer) => worker.postMessage({ buffer, name: file.name }, [buffer]));
  }, []);

  /* ---------- drag & drop global ---------- */
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragOver(true);
    };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) parseFile(file);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [parseFile]);

  /* ---------- rango de fechas ---------- */
  useEffect(() => {
    if (!dataset) return;
    setCustomFrom(toDateInput(dataset.meta.minTime));
    setCustomTo(toDateInput(dataset.meta.maxTime));
  }, [dataset]);

  const range = useMemo<DateRange>(() => {
    const from = parseDateInput(customFrom);
    const to = parseDateInput(customTo);
    if (from === null && to === null) return { from: null, to: null };
    // rango invertido: se intercambia en vez de mostrar un dashboard vacío
    const lo = from !== null && to !== null && from > to ? to : from;
    const hi = from !== null && to !== null && from > to ? from : to;
    return { from: lo, to: hi !== null ? hi + DAY : null };
  }, [customFrom, customTo]);

  const stats = useMemo(() => (dataset ? computeStats(dataset, range, grupo) : null), [dataset, range, grupo]);

  /* ---------- listado de bloqueados: búsqueda y exportación ---------- */
  const bloqueadosFiltrados = useMemo(() => {
    if (!stats) return [];
    const q = busqueda.trim().toLowerCase();
    if (!q) return stats.bloqueados;
    return stats.bloqueados.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.id).includes(q) ||
        p.dept.toLowerCase().includes(q) ||
        (CARRERAS[p.dept] ?? '').toLowerCase().includes(q),
    );
  }, [stats, busqueda]);

  const descargarBloqueados = useCallback(async () => {
    if (!dataset || bloqueadosFiltrados.length === 0) return;
    setExportando(true);
    try {
      const { exportBloqueados } = await import('./lib/export');
      await exportBloqueados(bloqueadosFiltrados, {
        from: range.from ?? dataset.meta.minTime,
        to: Math.min((range.to ?? dataset.meta.maxTime) - 1, dataset.meta.maxTime),
      });
    } catch {
      setError('No se pudo generar el archivo XLS.');
    } finally {
      setExportando(false);
    }
  }, [dataset, bloqueadosFiltrados, range]);

  /* ---------- tablas gemelas de cada gráfico ---------- */
  const tables = useMemo<Record<string, TableSpec> | null>(() => {
    if (!stats) return null;
    return {
      personas: {
        head: ['Fecha', 'Personas', 'Pasadas de entrada'],
        rows: stats.daily.map((d) => [fmtFecha(d.date), fmtInt(d.personas), fmtInt(d.entradas)]),
        numCols: [1, 2],
      },
      flujo: {
        head: ['Fecha', 'Entradas', 'Salidas'],
        rows: stats.daily.map((d) => [fmtFecha(d.date), fmtInt(d.entradas), fmtInt(d.salidas)]),
        numCols: [1, 2],
      },
      heatmap: {
        head: ['Día', ...Array.from({ length: 24 }, (_, h) => `${h}h`)],
        rows: stats.heatmap.map((row, d) => [DIAS_SEMANA[d], ...row.map((v) => fmtInt(v))]),
        numCols: Array.from({ length: 24 }, (_, i) => i + 1),
      },
      depts: {
        head: ['Carrera', 'Personas', 'Bloqueadas', '% bloqueadas'],
        rows: stats.deptStats.map((s) => [
          `${s.name} — ${CARRERAS[s.name] ?? s.name}`, fmtInt(s.personas), fmtInt(s.bloqueadas), fmtPct(s.pct),
        ]),
        numCols: [1, 2, 3],
      },
      intentos: {
        head: ['Fecha', 'Intentos de personas bloqueadas'],
        rows: stats.daily.map((d) => [fmtFecha(d.date), fmtInt(d.intentosBloqueados)]),
        numCols: [1],
      },
      devices: {
        head: ['Molinete', 'Entradas', 'Salidas'],
        rows: stats.deviceStats.map((s) => [s.name, fmtInt(s.entradas), fmtInt(s.salidas)]),
        numCols: [1, 2],
      },
      ver: {
        head: ['Modo', 'Verificaciones', '%'],
        rows: [
          ['Solo huella', fmtInt(stats.verModes.huella), fmtPct((stats.verModes.huella / Math.max(1, stats.verModes.huella + stats.verModes.tarjeta + stats.verModes.otro)) * 100)],
          ['Solo tarjeta', fmtInt(stats.verModes.tarjeta), fmtPct((stats.verModes.tarjeta / Math.max(1, stats.verModes.huella + stats.verModes.tarjeta + stats.verModes.otro)) * 100)],
          ['Otro', fmtInt(stats.verModes.otro), fmtPct((stats.verModes.otro / Math.max(1, stats.verModes.huella + stats.verModes.tarjeta + stats.verModes.otro)) * 100)],
        ],
        numCols: [1, 2],
      },
    };
  }, [stats]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Control de Acceso — Molinetes</h1>
          <p className="subtitle">Entrada principal · 4 molinetes ZKTeco</p>
        </div>
        <div className="header-spacer" />
        {dataset && (
          <span className="source-chip" title={dataset.meta.sourceName}>
            {isDefault ? 'Datos de ejemplo · ' : ''}{dataset.meta.sourceName}
          </span>
        )}
        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          aria-label="Cambiar tema"
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="3.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7.5 1v1.8M7.5 12.2V14M14 7.5h-1.8M2.8 7.5H1M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3M12.1 12.1l-1.3-1.3M4.2 4.2L2.9 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M13 9.5A5.8 5.8 0 0 1 5.5 2 5.8 5.8 0 1 0 13 9.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 10V2.5m0 0L4.5 5.5m3-3 3 3M2.5 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Subir XLS
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) parseFile(f);
            e.target.value = '';
          }}
        />
      </header>

      {error && <p className="upload-error" style={{ paddingBottom: 12 }}>{error}</p>}

      {stats && dataset && tables && (
        <>
          <div className="filter-row">
            <div className="seg seg-tabs" role="tablist" aria-label="Grupo de personas">
              {([['estudiantes', 'Estudiantes'], ['administrativos', 'Administrativos']] as [Grupo, string][]).map(([g, label]) => (
                <button key={g} role="tab" aria-selected={grupo === g} aria-pressed={grupo === g} onClick={() => setGrupo(g)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="date-range" role="group" aria-label="Rango de fechas">
              <input
                type="date"
                className="date-input"
                value={customFrom}
                min={toDateInput(dataset.meta.minTime)}
                max={toDateInput(dataset.meta.maxTime)}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Desde"
              />
              <span className="date-sep">→</span>
              <input
                type="date"
                className="date-input"
                value={customTo}
                min={toDateInput(dataset.meta.minTime)}
                max={toDateInput(dataset.meta.maxTime)}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Hasta"
              />
            </div>
            <span className="filter-range">
              {fmtRango(range.from ?? dataset.meta.minTime, Math.min((range.to ?? dataset.meta.maxTime) - 1, dataset.meta.maxTime))}
              {' · '}{stats.dias} día{stats.dias === 1 ? '' : 's'} con datos
            </span>
          </div>

          <div className={`dashboard grid${parsing ? ' is-loading' : ''}`}>
            {/* ---------- KPIs ---------- */}
            <div className="kpi-row">
              <section className="card" style={{ '--stagger': 0 } as CSSProperties}>
                <p className="stat-label">Total de personas</p>
                <p className="stat-value">{fmtInt(stats.personasUnicas)}</p>
                <p className="stat-hint">{fmtInt(stats.totalPasadas)} pasadas de molinete</p>
              </section>
              <section className="card" style={{ '--stagger': 1 } as CSSProperties}>
                <p className="stat-label">Personas que ingresaron</p>
                <p className="stat-value">{fmtInt(stats.personasEntrada)}</p>
                <p className="stat-hint">{fmtInt(stats.entradas)} pasadas de entrada</p>
              </section>
              <section className="card" style={{ '--stagger': 2 } as CSSProperties}>
                <p className="stat-label">Personas que salieron</p>
                <p className="stat-value">{fmtInt(stats.personasSalida)}</p>
                <p className="stat-hint">{fmtInt(stats.salidas)} pasadas de salida</p>
              </section>
              {grupo === 'estudiantes' && (
                <section className="card" style={{ '--stagger': 3 } as CSSProperties}>
                  <p className="stat-label">Bloqueados por deuda</p>
                  <p className="stat-value">{fmtInt(stats.bloqueadosUnicos)}</p>
                  <p className="stat-hint">{fmtPct(stats.pctBloqueados)} de las personas del período</p>
                </section>
              )}
              <section className="card" style={{ '--stagger': 4 } as CSSProperties}>
                <p className="stat-label">Día pico</p>
                <p className="stat-value">{stats.diaPico ? fmtFechaCorta(stats.diaPico.date) : '—'}</p>
                <p className="stat-hint">
                  {stats.diaPico ? `${fmtInt(stats.diaPico.personas)} personas (${fmtFecha(stats.diaPico.date).split(' ')[0]})` : 'sin datos'}
                </p>
              </section>
            </div>

            {/* ---------- Afluencia ---------- */}
            <div style={{ '--stagger': 4, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={8}
                title="Personas que ingresan por día"
                sub="Personas distintas con al menos una entrada en el día; excluye eventos sin persona asociada"
                table={tables.personas}
              >
                <DailyColumns data={stats.daily} color="var(--series-1)" valueLabel={['personas', 'personas']} />
              </ChartCard>
            </div>
            <div style={{ '--stagger': 5, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={4}
                title="Modo de verificación"
                sub={`${fmtPct(stats.pctHuella)} de los accesos usa huella`}
                table={tables.ver}
              >
                <VerModeBar modes={stats.verModes} />
              </ChartCard>
            </div>
            <div style={{ '--stagger': 6, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={6}
                title="Flujo de pasadas por día"
                sub="Activaciones de molinete (no personas)"
                legend={[
                  { label: 'Entradas', color: 'var(--series-1)', shape: 'line' },
                  { label: 'Salidas', color: 'var(--series-2)', shape: 'line' },
                ]}
                table={tables.flujo}
              >
                <FlowLines data={stats.daily} />
              </ChartCard>
            </div>
            <div style={{ '--stagger': 7, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={6}
                title="Afluencia por hora y día de la semana"
                sub="Pasadas de entrada; más intenso = más entradas"
                table={tables.heatmap}
              >
                <HourHeatmap matrix={stats.heatmap} max={stats.heatmapMax} theme={theme} />
              </ChartCard>
            </div>

            {/* ---------- Bloqueados por deuda (solo estudiantes) ---------- */}
            {grupo === 'estudiantes' && (
            <>
            <h2 className="section-title" style={{ '--stagger': 8 } as CSSProperties}>Bloqueados por deuda</h2>
            <div style={{ '--stagger': 9, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={6}
                title="% de personas bloqueadas por carrera"
                sub="Personas bloqueadas / personas de la carrera que pasaron en el período"
                table={tables.depts}
              >
                <DeptBlockedBars stats={stats.deptStats} />
              </ChartCard>
            </div>
            <div style={{ '--stagger': 10, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={6}
                title="Intentos de acceso de personas bloqueadas por día"
                sub="Un pico sostenido suele marcar la fecha de corte de pagos"
                table={tables.intentos}
              >
                <DailyColumns data={stats.daily} color="var(--series-2)" valueLabel={['intentosBloqueados', 'intentos']} />
              </ChartCard>
            </div>
            <section className="card span-12" style={{ '--stagger': 11 } as CSSProperties}>
              <div className="chart-head">
                <div>
                  <h2 className="chart-title">Estudiantes bloqueados por deuda</h2>
                  <p className="chart-sub">
                    {fmtInt(stats.bloqueados.length)} personas en el período, de más a menos intentos
                    {busqueda && ` · ${fmtInt(bloqueadosFiltrados.length)} coinciden con la búsqueda`}
                  </p>
                </div>
                <div className="chart-actions">
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Buscar nombre, ID o carrera…"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    aria-label="Buscar estudiante bloqueado"
                  />
                  <button
                    className="btn"
                    onClick={descargarBloqueados}
                    disabled={exportando || bloqueadosFiltrados.length === 0}
                  >
                    <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                      <path d="M7.5 2v8m0 0 3-3m-3 3-3-3M2.5 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {exportando ? 'Generando…' : 'Descargar XLS'}
                  </button>
                </div>
              </div>
              <div className="table-view table-view-tall">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>ID</th>
                      <th>Nombre completo</th>
                      <th>Carrera</th>
                      <th className="num">Intentos</th>
                      <th>Primer intento</th>
                      <th>Último intento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloqueadosFiltrados.map((p, i) => (
                      <tr key={p.id}>
                        <td className="num" style={{ color: 'var(--muted)' }}>{i + 1}</td>
                        <td>{p.id}</td>
                        <td>{p.name || '—'}</td>
                        <td title={CARRERAS[p.dept] ?? p.dept}>{p.dept}</td>
                        <td className="num">{fmtInt(p.intentos)}</td>
                        <td>{fmtFecha(new Date(p.primero))}</td>
                        <td>{fmtFecha(new Date(p.ultimo))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bloqueadosFiltrados.length === 0 && (
                  <p style={{ color: 'var(--muted)', padding: '18px 0', textAlign: 'center' }}>
                    Ningún estudiante coincide con “{busqueda}”.
                  </p>
                )}
              </div>
            </section>
            </>
            )}

            {/* ---------- Molinetes ---------- */}
            <div style={{ '--stagger': 12, display: 'contents' } as CSSProperties}>
              <ChartCard
                span={6}
                title="Balance por molinete"
                sub="Pasadas de entrada y salida por dispositivo"
                legend={[
                  { label: 'Entradas', color: 'var(--series-1)', shape: 'rect' },
                  { label: 'Salidas', color: 'var(--series-2)', shape: 'rect' },
                ]}
                table={tables.devices}
              >
                <DeviceBars stats={stats.deviceStats} />
              </ChartCard>
            </div>
            {/* ---------- Carga de datos ---------- */}
            <section
              className={`card span-6 upload-card${dragOver ? ' drag-over' : ''}`}
              style={{ '--stagger': 13 } as CSSProperties}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <p className="up-title">{parsing ? 'Procesando archivo…' : 'Actualizar datos'}</p>
              <p className="up-sub">
                Arrastra aquí el reporte <strong>“Todos los Eventos”</strong> exportado del sistema (.xls/.xlsx)
                o haz clic para elegirlo. Todo el dashboard se recalcula con el nuevo archivo — nada sale de tu equipo.
              </p>
            </section>
          </div>
        </>
      )}

      {!stats && !error && (
        <p style={{ color: 'var(--muted)', padding: '40px 0', textAlign: 'center' }}>Cargando datos…</p>
      )}

      <div className={`drop-overlay${dragOver ? ' visible' : ''}`} aria-hidden="true">
        <div className="drop-box">Suelta el archivo XLS para actualizar el dashboard</div>
      </div>
    </div>
  );
}
