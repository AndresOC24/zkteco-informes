// Convierte el XLS de ejemplo a public/default-data.json (dataset compacto)
// para que el dashboard cargue con datos sin necesidad de subir un archivo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseSheetRows } from '../src/lib/parse.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, 'Todos los Eventos_20260424111010.xls');

const wb = XLSX.read(readFileSync(source), { cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
const dataset = parseSheetRows(rows, source.split('/').pop());

mkdirSync(join(root, 'public'), { recursive: true });
const out = join(root, 'public', 'default-data.json');
writeFileSync(out, JSON.stringify(dataset));

console.log(`OK → ${out}`);
console.log(`  eventos: ${dataset.meta.totalRows}`);
console.log(`  rango: ${new Date(dataset.meta.minTime).toISOString()} → ${new Date(dataset.meta.maxTime).toISOString()}`);
console.log(`  dispositivos: ${dataset.devices.join(', ')}`);
console.log(`  departamentos: ${dataset.depts.join(', ')}`);
console.log(`  bloqueados únicos: ${Object.keys(dataset.blockedNames).length}`);
