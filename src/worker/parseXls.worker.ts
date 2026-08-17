// Parsea el XLS fuera del hilo principal: 100k filas bloquearían la UI varios segundos.
import * as XLSX from 'xlsx';
import { parseSheetRows } from '../lib/parse.js';
import type { Dataset } from '../lib/types';

export interface ParseRequest {
  buffer: ArrayBuffer;
  name: string;
}

export type ParseResponse =
  | { ok: true; dataset: Dataset }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  try {
    const wb = XLSX.read(e.data.buffer, { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('El archivo no tiene hojas.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][];
    const dataset = parseSheetRows(rows, e.data.name) as Dataset;
    const res: ParseResponse = { ok: true, dataset };
    self.postMessage(res);
  } catch (err) {
    const res: ParseResponse = { ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};
