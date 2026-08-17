# Control de Acceso — Molinetes

Dashboard de análisis del log de molinetes (ZKTeco) de la entrada principal de la
universidad. Todo corre en el navegador: se sube el reporte **"Todos los Eventos"**
(.xls/.xlsx) y todos los KPIs, gráficos y tablas se recalculan al instante. Nada
sale del equipo (no hay backend).

## Uso

```bash
npm install
npm run dev        # desarrollo → http://localhost:5173
npm run build      # build de producción en dist/
npm run preview    # sirve el build → http://localhost:4173
```

Para regenerar el dataset de ejemplo embebido (`public/default-data.json`) a
partir de un XLS:

```bash
npm run convert-default                 # usa "Todos los Eventos_20260424111010.xls"
node scripts/convert-default.mjs otro_reporte.xls
```

## Qué muestra

- **KPIs**: personas únicas, pasadas de entrada/salida, bloqueados por deuda
  (únicos, % e intentos), día pico.
- **Afluencia**: personas únicas por día, flujo entrada/salida por día, heatmap
  hora × día de la semana.
- **Bloqueados por deuda**: % por carrera, intentos por día (el pico marca la
  fecha de corte de pagos), top 10 reincidentes.
- **Molinetes**: balance entrada/salida por dispositivo y salud (eventos de
  conexión) para mantenimiento.
- Filtro de rango de fechas (todo / 7 días / 3 días, relativo al último día con
  datos) que re-escala todo el dashboard.
- Cada gráfico tiene **vista de tabla** (botón en la esquina de la tarjeta),
  tooltips al pasar el cursor, y tema claro/oscuro.

## Reglas de datos importantes

Heredadas del análisis del reporte (ver `contexto_reporte_molinetes.txt`):

- Cada fila del XLS es **una pasada de molinete, no una persona**. Los conteos de
  personas usan IDs únicos.
- Los eventos "Usuario no registrado" no tienen ID y se excluyen de los conteos
  por persona/carrera.
- El molinete `192.168.5.106` no indica Entrada/Salida en el texto: sufijo
  `-2` = entrada, `-1` = salida (los demás sí lo dicen).
- "Deshabilitada" = estudiante bloqueado por deuda **que intentó pasar**; un
  bloqueado que no fue al campus no aparece.
- El archivo dice `.xls` pero es formato xlsx moderno; SheetJS lo autodetecta.

## Arquitectura

- **Vite + React + TypeScript**, sin backend.
- `src/lib/parse.js` — parser compartido XLS → dataset compacto columnar; lo usan
  el Web Worker del navegador y el script Node de conversión.
- `src/worker/parseXls.worker.ts` — parsing en Web Worker (100k filas sin
  congelar la UI).
- `src/lib/stats.ts` — todas las agregaciones a partir del dataset + rango.
- `src/components/charts.tsx` — gráficos SVG propios (columnas, líneas con
  crosshair, heatmap, barras, apilada) con la paleta validada del sistema de
  dataviz.
- El último archivo subido persiste en IndexedDB; "Restaurar ejemplo" vuelve al
  dataset embebido.
