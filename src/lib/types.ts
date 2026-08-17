/** Códigos de tipo de evento (columna "Descripción del Evento") */
export const KIND = {
  OK: 0, // Apertura con verificación normal
  NO_REGISTRADO: 1, // Usuario no registrado (ID/Nombre nulos)
  DESHABILITADA: 2, // Estudiante bloqueado por deuda
  CONECTADO: 3,
  NO_CONECTA: 4,
  DESCONECTADO: 5,
  INICIALIZADO: 6,
  OTRO: 7,
} as const;

/** Códigos de "Modo de Verificación" */
export const VER = { HUELLA: 0, TARJETA: 1, OTRO: 2 } as const;

/** Dataset compacto columnar: una posición por evento (fila del XLS). */
export interface Dataset {
  meta: {
    sourceName: string;
    totalRows: number;
    /** epoch ms */
    minTime: number;
    /** epoch ms */
    maxTime: number;
  };
  /** IPs de molinetes, indexadas por rows.dev */
  devices: string[];
  /** Departamentos/carreras, indexados por rows.dept */
  depts: string[];
  /** Nombre completo por ID, solo para personas con eventos de bloqueo */
  blockedNames: Record<string, string>;
  rows: {
    /** epoch ms */
    t: number[];
    /** índice en devices */
    dev: number[];
    /** 1 = entrada, -1 = salida, 0 = indeterminado */
    dir: number[];
    /** ver KIND */
    kind: number[];
    /** ID de persona; -1 = nulo (no registrado / evento de equipo) */
    id: number[];
    /** índice en depts; -1 = sin departamento */
    dept: number[];
    /** ver VER */
    ver: number[];
  };
}
