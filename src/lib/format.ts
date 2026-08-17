const nf = new Intl.NumberFormat('es-BO');
const nf1 = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtInt = (n: number): string => nf.format(Math.round(n));
export const fmtPct = (n: number): string => `${nf1.format(n)}%`;

export const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "mar 14 abr" */
export function fmtFecha(d: Date): string {
  return `${DIAS_SEMANA[(d.getDay() + 6) % 7].toLowerCase()} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "14 abr" */
export function fmtFechaCorta(d: Date): string {
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** "7 abr — 24 abr 2026" */
export function fmtRango(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  return `${a.getDate()} ${MESES[a.getMonth()]} — ${b.getDate()} ${MESES[b.getMonth()]} ${b.getFullYear()}`;
}
