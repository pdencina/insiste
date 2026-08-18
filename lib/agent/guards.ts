/**
 * Guardas de seguridad — El único módulo que autoriza un envío.
 *
 * Si `puedeEnviar()` devuelve false, NO SALE NADA.
 * No duplicar esta lógica en ningún otro módulo.
 *
 * Kill switches implementados:
 * 1. Interruptor global (envio_habilitado = false)
 * 2. Modo solo borradores
 * 3. Intervención manual gana
 * 4. Tope por destinatario por semana
 * 5. Idempotencia (clave única por hilo e intento)
 * 6. Ventana hábil (verificada al momento del envío)
 */

import { createServiceClient } from "@/lib/supabase/client";
import type { Cuenta, Reglas, Seguimiento } from "@/lib/supabase/types";
import { esHorarioHabil } from "./cadence";

export interface GuardResult {
  permitido: boolean;
  razon: string;
  usarBorrador: boolean; // Si true, crear borrador en vez de enviar
}

export interface GuardContext {
  cuenta: Cuenta;
  reglas: Reglas;
  seguimiento: Seguimiento;
  intento: number;
  tieneIntervencionManual: boolean;
}

/**
 * Verifica TODAS las condiciones necesarias para autorizar un envío.
 * Es la función principal que los crons deben llamar antes de enviar.
 */
export async function puedeEnviar(ctx: GuardContext): Promise<GuardResult> {
  const { cuenta, reglas, seguimiento, intento, tieneIntervencionManual } = ctx;

  // 1. Kill switch global
  if (!cuenta.envio_habilitado) {
    return {
      permitido: false,
      razon: "Envío deshabilitado globalmente para esta cuenta",
      usarBorrador: false,
    };
  }

  // 2. Estado de la cuenta
  if (cuenta.estado !== "activa") {
    return {
      permitido: false,
      razon: `Cuenta en estado "${cuenta.estado}"`,
      usarBorrador: false,
    };
  }

  // 3. Estado del seguimiento
  if (seguimiento.estado !== "activo") {
    return {
      permitido: false,
      razon: `Seguimiento en estado "${seguimiento.estado}"`,
      usarBorrador: false,
    };
  }

  // 4. Intervención manual gana
  if (tieneIntervencionManual) {
    return {
      permitido: false,
      razon: "El usuario intervino manualmente en el hilo",
      usarBorrador: false,
    };
  }

  // 5. Ventana hábil (verificada en el momento, no solo al programar)
  const ahora = new Date();
  if (!esHorarioHabil(ahora, reglas)) {
    return {
      permitido: false,
      razon: "Fuera de ventana hábil",
      usarBorrador: false,
    };
  }

  // 6. Idempotencia — verificar que no se haya enviado ya
  const claveIdempotencia = buildIdempotencyKey(seguimiento.id, intento);
  const yaEnviado = await existeEnvio(claveIdempotencia, seguimiento.user_id);
  if (yaEnviado) {
    return {
      permitido: false,
      razon: `Envío ya registrado con clave ${claveIdempotencia}`,
      usarBorrador: false,
    };
  }

  // 7. Tope por destinatario por semana
  const excedeTope = await excedeTopeDestinatario(
    seguimiento.destinatarios,
    seguimiento.user_id,
    reglas.tope_semanal_destinatario
  );
  if (excedeTope) {
    return {
      permitido: false,
      razon: `Tope semanal de ${reglas.tope_semanal_destinatario} recordatorios por destinatario alcanzado`,
      usarBorrador: false,
    };
  }

  // 8. Modo solo borradores — permitido pero como borrador
  if (reglas.solo_borradores) {
    return {
      permitido: true,
      razon: "Modo solo borradores activo",
      usarBorrador: true,
    };
  }

  // Todo OK
  return {
    permitido: true,
    razon: "Todas las guardas pasaron",
    usarBorrador: false,
  };
}

/**
 * Construye la clave de idempotencia para un envío.
 * Formato: {seguimiento_id}:{intento}
 */
export function buildIdempotencyKey(seguimientoId: string, intento: number): string {
  return `${seguimientoId}:${intento}`;
}

/**
 * Verifica si ya existe un envío con esta clave de idempotencia.
 */
async function existeEnvio(clave: string, userId: string): Promise<boolean> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("envios")
    .select("id")
    .eq("user_id", userId)
    .eq("clave_idempotencia", clave)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

/**
 * Verifica si alguno de los destinatarios excede el tope semanal de recordatorios.
 * Suma todos los envíos exitosos de tipo "recordatorio" a ese destinatario en los
 * últimos 7 días, a través de todos los hilos.
 */
async function excedeTopeDestinatario(
  destinatarios: string[],
  userId: string,
  tope: number
): Promise<boolean> {
  const supabase = createServiceClient();

  // Calcular inicio de la semana (7 días atrás)
  const hace7Dias = new Date();
  hace7Dias.setDate(hace7Dias.getDate() - 7);

  for (const destinatario of destinatarios) {
    // Buscar seguimientos con este destinatario
    const { data: seguimientos } = await supabase
      .from("seguimientos")
      .select("id")
      .eq("user_id", userId)
      .contains("destinatarios", [destinatario]);

    if (!seguimientos || seguimientos.length === 0) continue;

    const segIds = seguimientos.map((s) => s.id);

    // Contar envíos exitosos de tipo recordatorio en la última semana
    const { count } = await supabase
      .from("envios")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "recordatorio")
      .eq("estado", "enviado")
      .in("seguimiento_id", segIds)
      .gte("creado_en", hace7Dias.toISOString());

    if ((count ?? 0) >= tope) {
      return true;
    }
  }

  return false;
}

/**
 * Registra un evento de auditoría para cada decisión del agente.
 */
export async function registrarEvento(
  userId: string,
  seguimientoId: string | null,
  accion: string,
  detalle: Record<string, unknown>
): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from("eventos").insert({
    user_id: userId,
    seguimiento_id: seguimientoId,
    accion,
    detalle,
  });
}
