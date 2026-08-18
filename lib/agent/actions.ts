/**
 * Matriz clase → acción — El corazón del producto.
 *
 * Este archivo debe poder leerse completo de una mirada.
 * Es la lógica que el usuario necesita entender para confiar en el agente.
 *
 * | Clase         | Cierra | Reinicia reloj | Acción                                    |
 * |---------------|--------|----------------|-------------------------------------------|
 * | entregado     | Sí     | —              | Acuse automático, etiqueta cerrado        |
 * | rechazo       | Sí     | —              | Cierra, notifica. Sin acuse               |
 * | pregunta      | Pausa  | —              | Crea borrador, notifica                   |
 * | promesa       | No     | Sí (fecha+2d)  | Reprograma                                |
 * | automatico    | No     | NO             | Registra y sigue                          |
 * | irrelevante   | No     | NO             | Registra y sigue                          |
 * | rebote        | Sí     | —              | Cierra, notifica dirección inválida       |
 * | baja_confianza| Pausa  | —              | Notifica, espera decisión humana          |
 */

import type { ClaseRespuesta, EstadoSeguimiento, MotivoCierre } from "@/lib/supabase/types";

export interface Accion {
  nuevoEstado: EstadoSeguimiento;
  motivoCierre: MotivoCierre | null;
  reiniciaReloj: boolean;
  enviarAcuse: boolean;
  crearBorrador: boolean;
  notificar: boolean;
  descripcion: string;
}

/**
 * Matriz completa de acciones por clase de respuesta.
 */
export const ACCIONES: Record<ClaseRespuesta, Accion> = {
  entregado: {
    nuevoEstado: "cerrado",
    motivoCierre: "entregado",
    reiniciaReloj: false,
    enviarAcuse: true, // Solo si acuse_automatico está activo
    crearBorrador: false,
    notificar: true,
    descripcion: "Objetivo cumplido. Acusar recibo y cerrar.",
  },

  rechazo: {
    nuevoEstado: "cerrado",
    motivoCierre: "rechazo",
    reiniciaReloj: false,
    enviarAcuse: false,
    crearBorrador: false,
    notificar: true,
    descripcion: "Rechazado explícitamente. Cerrar sin acuse.",
  },

  pregunta: {
    nuevoEstado: "pausado",
    motivoCierre: null,
    reiniciaReloj: false,
    enviarAcuse: false,
    crearBorrador: true,
    notificar: true,
    descripcion: "La contraparte pregunta algo. Borrador y esperar al usuario.",
  },

  promesa: {
    nuevoEstado: "activo",
    motivoCierre: null,
    reiniciaReloj: true,
    enviarAcuse: false,
    crearBorrador: false,
    notificar: false,
    descripcion: "Promete entregar. Reprogramar a fecha prometida + 2 días hábiles.",
  },

  automatico: {
    nuevoEstado: "activo",
    motivoCierre: null,
    reiniciaReloj: false, // ← Crítico: NO reinicia el reloj
    enviarAcuse: false,
    crearBorrador: false,
    notificar: false,
    descripcion: "Mensaje automático (OOO, autoresponder). Ignorar.",
  },

  irrelevante: {
    nuevoEstado: "activo",
    motivoCierre: null,
    reiniciaReloj: false, // ← Crítico: NO reinicia el reloj
    enviarAcuse: false,
    crearBorrador: false,
    notificar: false,
    descripcion: "Mensaje no relacionado con el objetivo. Ignorar.",
  },

  rebote: {
    nuevoEstado: "cerrado",
    motivoCierre: "rebote",
    reiniciaReloj: false,
    enviarAcuse: false,
    crearBorrador: false,
    notificar: true,
    descripcion: "Dirección inválida o buzón lleno. Cerrar y avisar.",
  },
};

/**
 * Acción especial cuando la confianza del clasificador es baja (< umbral).
 * No está en la matriz porque aplica transversalmente a cualquier clase.
 */
export const ACCION_BAJA_CONFIANZA: Accion = {
  nuevoEstado: "pausado",
  motivoCierre: null,
  reiniciaReloj: false,
  enviarAcuse: false,
  crearBorrador: false,
  notificar: true,
  descripcion: "Confianza insuficiente. Pausar y esperar decisión humana.",
};

/**
 * Determina la acción a tomar dada una clasificación.
 * Aplica el umbral de confianza antes de consultar la matriz.
 */
export function determinarAccion(
  clase: ClaseRespuesta,
  confianza: number,
  umbralConfianza: number
): Accion {
  // Baja confianza siempre pausa, sin importar la clase
  if (confianza < umbralConfianza) {
    return ACCION_BAJA_CONFIANZA;
  }

  return ACCIONES[clase];
}
