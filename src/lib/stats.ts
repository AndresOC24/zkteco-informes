import type { Dataset } from './types';
import { KIND } from './types';

// Reglas de cálculo (ver contexto_reporte_molinetes.txt):
// - FILA = pasada de molinete; PERSONA = ID único. "Cuántos ingresan" cuenta IDs
//   únicos; "flujo/afluencia" cuenta filas.
// - Eventos "Usuario no registrado" tienen ID nulo: se excluyen de todo conteo
//   por persona/carrera.
// - "Deshabilitada" = estudiante bloqueado por deuda que INTENTÓ pasar.

export interface DailyPoint {
  /** clave YYYY-MM-DD (hora local) */
  key: string;
  date: Date;
  entradas: number;
  salidas: number;
  personas: number;
  intentosBloqueados: number;
}

export interface DeptStat {
  name: string;
  personas: number;
  bloqueadas: number;
  pct: number;
}

export interface DeviceStat {
  name: string;
  entradas: number;
  salidas: number;
  conectado: number;
  noConecta: number;
  desconectado: number;
  inicializado: number;
}

export interface BlockedPerson {
  id: number;
  name: string;
  dept: string;
  intentos: number;
  /** epoch ms del primer y último intento dentro del rango */
  primero: number;
  ultimo: number;
}

export interface Stats {
  totalPasadas: number;
  entradas: number;
  salidas: number;
  personasUnicas: number;
  /** personas distintas con al menos una pasada de entrada */
  personasEntrada: number;
  /** personas distintas con al menos una pasada de salida */
  personasSalida: number;
  bloqueadosUnicos: number;
  pctBloqueados: number;
  intentosBloqueados: number;
  noRegistrados: number;
  diaPico: DailyPoint | null;
  pctHuella: number;
  verModes: { huella: number; tarjeta: number; otro: number };
  daily: DailyPoint[];
  /** [díaSemana 0=Lun][hora 0-23] → pasadas de entrada */
  heatmap: number[][];
  heatmapMax: number;
  deptStats: DeptStat[];
  deviceStats: DeviceStat[];
  /** todas las personas bloqueadas del rango, de más a menos intentos */
  bloqueados: BlockedPerson[];
  dias: number;
}

export function dateKey(t: number): string {
  const d = new Date(t);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

export interface DateRange {
  /** inicio del día, epoch ms local; null = sin límite */
  from: number | null;
  /** FIN del día (exclusivo), epoch ms local; null = sin límite */
  to: number | null;
}

/**
 * Segmento de población. "administrativos" agrupa los departamentos
 * ADMINISTRATIVO y VISITA; "estudiantes" es todo el resto de carreras.
 * Los eventos sin departamento (usuario no registrado, eventos de equipo)
 * quedan fuera de ambos grupos.
 */
export type Grupo = 'estudiantes' | 'administrativos';

const ADMIN_DEPTS = new Set(['ADMINISTRATIVO', 'VISITA']);

export function computeStats(ds: Dataset, range: DateRange, grupo: Grupo): Stats {
  const { t, dev, dir, kind, id, dept, ver } = ds.rows;
  const n = t.length;
  const from = range.from ?? -Infinity;
  const to = range.to ?? Infinity;

  let entradas = 0;
  let salidas = 0;
  let total = 0;
  let noRegistrados = 0;
  let intentosBloqueados = 0;
  const verModes = { huella: 0, tarjeta: 0, otro: 0 };

  const personas = new Set<number>();
  const personasEntrada = new Set<number>();
  const personasSalida = new Set<number>();
  const bloqueados = new Set<number>();
  const daily = new Map<string, DailyPoint & { ids: Set<number> }>();
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));

  const deptPersonas: Set<number>[] = ds.depts.map(() => new Set());
  const deptBloqueadas: Set<number>[] = ds.depts.map(() => new Set());
  const deviceStats: DeviceStat[] = ds.devices.map((name) => ({
    name, entradas: 0, salidas: 0, conectado: 0, noConecta: 0, desconectado: 0, inicializado: 0,
  }));
  const intentosPorPersona = new Map<number, { n: number; primero: number; ultimo: number; dept: number }>();

  const adminIdx = new Set<number>();
  ds.depts.forEach((name, i) => { if (ADMIN_DEPTS.has(name.toUpperCase())) adminIdx.add(i); });

  for (let i = 0; i < n; i++) {
    const ti = t[i];
    if (ti < from || ti >= to) continue;
    const dp = dept[i];
    if (dp < 0) continue;
    const esAdmin = adminIdx.has(dp);
    if (grupo === 'estudiantes' ? esAdmin : !esAdmin) continue;
    total++;

    const k = kind[i];
    const personId = id[i];
    const d = new Date(ti);
    const key = dateKey(ti);
    let day = daily.get(key);
    if (!day) {
      day = {
        key,
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
        entradas: 0, salidas: 0, personas: 0, intentosBloqueados: 0,
        ids: new Set(),
      };
      daily.set(key, day);
    }

    const dv = deviceStats[dev[i]];
    if (dir[i] === 1) {
      entradas++;
      day.entradas++;
      if (dv) dv.entradas++;
      // Heatmap con lunes como día 0
      heatmap[(d.getDay() + 6) % 7][d.getHours()]++;
    } else if (dir[i] === -1) {
      salidas++;
      day.salidas++;
      if (dv) dv.salidas++;
    }

    if (k === KIND.NO_REGISTRADO) noRegistrados++;
    if (k === KIND.CONECTADO && dv) dv.conectado++;
    if (k === KIND.NO_CONECTA && dv) dv.noConecta++;
    if (k === KIND.DESCONECTADO && dv) dv.desconectado++;
    if (k === KIND.INICIALIZADO && dv) dv.inicializado++;

    if (k === KIND.OK || k === KIND.DESHABILITADA || k === KIND.NO_REGISTRADO) {
      if (ver[i] === 0) verModes.huella++;
      else if (ver[i] === 1) verModes.tarjeta++;
      else verModes.otro++;
    }

    if (personId >= 0) {
      personas.add(personId);
      if (dir[i] === 1) { day.ids.add(personId); personasEntrada.add(personId); }
      if (dir[i] === -1) personasSalida.add(personId);
      const dp = dept[i];
      if (dp >= 0) deptPersonas[dp].add(personId);
      if (k === KIND.DESHABILITADA) {
        bloqueados.add(personId);
        intentosBloqueados++;
        day.intentosBloqueados++;
        if (dp >= 0) deptBloqueadas[dp].add(personId);
        const prev = intentosPorPersona.get(personId);
        if (prev) {
          prev.n++;
          if (ti < prev.primero) prev.primero = ti;
          if (ti > prev.ultimo) prev.ultimo = ti;
        } else {
          intentosPorPersona.set(personId, { n: 1, primero: ti, ultimo: ti, dept: dp });
        }
      }
    }
  }

  const dailyArr: DailyPoint[] = [...daily.values()]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map(({ ids, ...rest }) => ({ ...rest, personas: ids.size }));

  let diaPico: DailyPoint | null = null;
  for (const day of dailyArr) {
    if (!diaPico || day.personas > diaPico.personas) diaPico = day;
  }

  const deptStats: DeptStat[] = ds.depts
    .map((name, i) => ({
      name,
      personas: deptPersonas[i].size,
      bloqueadas: deptBloqueadas[i].size,
      pct: deptPersonas[i].size > 0 ? (deptBloqueadas[i].size / deptPersonas[i].size) * 100 : 0,
    }))
    .filter((s) => s.personas > 0)
    .sort((a, b) => b.pct - a.pct || b.bloqueadas - a.bloqueadas);

  const bloqueadosLista: BlockedPerson[] = [...intentosPorPersona.entries()]
    .map(([pid, v]) => ({
      id: pid,
      name: ds.blockedNames[pid] ?? '',
      dept: v.dept >= 0 ? ds.depts[v.dept] : '—',
      intentos: v.n,
      primero: v.primero,
      ultimo: v.ultimo,
    }))
    .sort((a, b) => b.intentos - a.intentos || a.name.localeCompare(b.name, 'es'));

  let heatmapMax = 0;
  for (const row of heatmap) for (const v of row) if (v > heatmapMax) heatmapMax = v;

  const totalVer = verModes.huella + verModes.tarjeta + verModes.otro;

  return {
    totalPasadas: total,
    entradas,
    salidas,
    personasUnicas: personas.size,
    personasEntrada: personasEntrada.size,
    personasSalida: personasSalida.size,
    bloqueadosUnicos: bloqueados.size,
    pctBloqueados: personas.size > 0 ? (bloqueados.size / personas.size) * 100 : 0,
    intentosBloqueados,
    noRegistrados,
    diaPico,
    pctHuella: totalVer > 0 ? (verModes.huella / totalVer) * 100 : 0,
    verModes,
    daily: dailyArr,
    heatmap,
    heatmapMax,
    deptStats,
    deviceStats,
    bloqueados: bloqueadosLista,
    dias: dailyArr.length,
  };
}
