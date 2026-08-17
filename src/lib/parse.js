// Parser compartido (navegador vía Web Worker y Node vía scripts/convert-default.mjs).
// Convierte el workbook del reporte ZKTeco a un Dataset compacto columnar.
//
// Reglas del formato fuente:
// - La fila 0 es un título; los encabezados reales están en la fila 1.
// - El molinete 192.168.5.106 no dice Entrada/Salida en "Punto del Evento":
//   sufijo -2 = ENTRADA, -1 = SALIDA. El resto ya lo dice en el texto.
// - ID/Tarjeta llegan como float (4699.0) y son nulos en "Usuario no registrado".

/** @typedef {import('./types').Dataset} Dataset */

const KIND_BY_DESC = new Map([
  ['apertura con verificación normal', 0],
  ['usuario no registrado', 1],
  ['deshabilitada', 2],
  ['conectado con el servidor', 3],
  ['no se puede conectar con el servidor', 4],
  ['desconectado', 5],
  ['equipo inicializado', 6],
]);

function normalize(value) {
  return String(value ?? '').trim();
}

function parseTime(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') {
    // Serial de Excel (días desde 1899-12-30), interpretado en hora local
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const utc = new Date(ms);
    return new Date(
      utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(),
      utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds(),
    ).getTime();
  }
  const s = normalize(value);
  if (!s) return NaN;
  // "2026-04-24 11:08:41" o "24/04/2026 11:08:41"
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]).getTime();
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})/);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1], +dmy[4], +dmy[5], +dmy[6]).getTime();
  const d = new Date(s);
  return d.getTime();
}

function parseDir(punto) {
  const p = normalize(punto);
  if (/entrada/i.test(p) || /106-2/.test(p)) return 1;
  if (/salida/i.test(p) || /106-1/.test(p)) return -1;
  return 0;
}

function parseKind(desc) {
  const k = KIND_BY_DESC.get(normalize(desc).toLowerCase());
  return k === undefined ? 7 : k;
}

function parseVer(mode) {
  const m = normalize(mode).toLowerCase();
  if (m.includes('huella')) return 0;
  if (m.includes('tarjeta')) return 1;
  return 2;
}

function parseDeptName(raw) {
  let d = normalize(raw);
  if (!d) return '';
  // Unifica singular/plural del personal administrativo
  if (/^administrativos?$/i.test(d)) return 'ADMINISTRATIVO';
  return d;
}

/**
 * @param {unknown[][]} sheetRows filas crudas (header:1) de la hoja "Todos los Eventos"
 * @param {string} sourceName nombre del archivo de origen
 * @returns {Dataset}
 */
export function parseSheetRows(sheetRows, sourceName) {
  // Encuentra la fila de encabezados: la que contiene "Tiempo"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(sheetRows.length, 10); i++) {
    const row = sheetRows[i] || [];
    if (row.some((c) => normalize(c).toLowerCase() === 'tiempo')) { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error('No se encontró la fila de encabezados (columna "Tiempo"). ¿Es el reporte "Todos los Eventos"?');
  }

  const headers = (sheetRows[headerRowIdx] || []).map((h) => normalize(h).toLowerCase());
  const col = (name) => headers.findIndex((h) => h.includes(name));
  const cTiempo = col('tiempo');
  const cDevice = col('dispositivo');
  const cPunto = col('punto del evento');
  const cDesc = col('descripción del evento') !== -1 ? col('descripción del evento') : col('descripcion del evento');
  const cId = headers.findIndex((h) => h === 'id');
  const cNombre = headers.findIndex((h) => h === 'nombre');
  const cApellido = col('apellido');
  const cDept = col('departamento');
  const cVer = col('verificación') !== -1 ? col('verificación') : col('verificacion');

  const missing = [];
  if (cTiempo === -1) missing.push('Tiempo');
  if (cPunto === -1) missing.push('Punto del Evento');
  if (cDesc === -1) missing.push('Descripción del Evento');
  if (missing.length) throw new Error(`Faltan columnas: ${missing.join(', ')}`);

  const devices = [];
  const deviceIdx = new Map();
  const depts = [];
  const deptIdx = new Map();
  const blockedNames = {};

  const t = [], dev = [], dir = [], kind = [], id = [], dept = [], ver = [];
  let minTime = Infinity, maxTime = -Infinity;

  for (let i = headerRowIdx + 1; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    if (!row || row.length === 0) continue;
    const time = parseTime(row[cTiempo]);
    if (!Number.isFinite(time)) continue;

    const deviceName = normalize(cDevice !== -1 ? row[cDevice] : '');
    let dvi = deviceIdx.get(deviceName);
    if (dvi === undefined) { dvi = devices.length; devices.push(deviceName); deviceIdx.set(deviceName, dvi); }

    const deptName = parseDeptName(cDept !== -1 ? row[cDept] : '');
    let dpi = -1;
    if (deptName) {
      dpi = deptIdx.get(deptName) ?? -1;
      if (dpi === -1) { dpi = depts.length; depts.push(deptName); deptIdx.set(deptName, dpi); }
    }

    const rawId = cId !== -1 ? row[cId] : null;
    const personId = rawId === null || rawId === undefined || rawId === '' ? -1 : Math.trunc(Number(rawId));
    const k = parseKind(row[cDesc]);

    if (k === 2 && personId >= 0 && blockedNames[personId] === undefined) {
      const nombre = normalize(cNombre !== -1 ? row[cNombre] : '');
      const apellido = normalize(cApellido !== -1 ? row[cApellido] : '');
      blockedNames[personId] = `${nombre} ${apellido}`.trim();
    }

    t.push(time);
    dev.push(dvi);
    dir.push(parseDir(row[cPunto]));
    kind.push(k);
    id.push(Number.isFinite(personId) ? personId : -1);
    dept.push(dpi);
    ver.push(parseVer(cVer !== -1 ? row[cVer] : ''));
    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;
  }

  if (t.length === 0) throw new Error('El archivo no contiene eventos válidos.');

  return {
    meta: { sourceName, totalRows: t.length, minTime, maxTime },
    devices,
    depts,
    blockedNames,
    rows: { t, dev, dir, kind, id, dept, ver },
  };
}
