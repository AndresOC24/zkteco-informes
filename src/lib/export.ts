import type { BlockedPerson } from './stats';
import { CARRERAS } from './carreras';

/** "2026-04-08 07:12:45" — formato legible por Excel sin ambigüedad de zona horaria */
function fmtDateTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDay(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Genera y descarga un XLSX con el listado de estudiantes bloqueados por deuda.
 * `xlsx` se importa de forma diferida: pesa ~330 kB y solo hace falta al exportar.
 */
export async function exportBloqueados(
  personas: BlockedPerson[],
  rango: { from: number; to: number },
): Promise<void> {
  const XLSX = await import('xlsx');

  const rows = personas.map((p) => ({
    ID: p.id,
    'Nombre completo': p.name || '(sin nombre en el reporte)',
    Carrera: p.dept,
    'Carrera (descripción)': CARRERAS[p.dept] ?? p.dept,
    'Intentos de acceso': p.intentos,
    'Primer intento': fmtDateTime(p.primero),
    'Último intento': fmtDateTime(p.ultimo),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 8 }, { wch: 34 }, { wch: 10 }, { wch: 32 },
    { wch: 18 }, { wch: 20 }, { wch: 20 },
  ];
  // Congela la fila de encabezados y activa el autofiltro
  ws['!freeze'] = { xSplit: '0', ySplit: '1' };
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bloqueados');

  XLSX.writeFile(wb, `estudiantes-bloqueados_${fmtDay(rango.from)}_a_${fmtDay(rango.to)}.xlsx`);
}
