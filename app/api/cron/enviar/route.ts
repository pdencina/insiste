/**
 * Cron: Enviar (cada 30 min)
 *
 * Busca seguimientos activos con proximo_intento vencido,
 * pasa cada uno por las guardas, y envía o crea borrador según corresponda.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { getThread, detectManualUserMessage } from "@/lib/gmail/threads";
import { sendInThread } from "@/lib/gmail/send";
import { createDraftInThread } from "@/lib/gmail/drafts";
import { puedeEnviar, buildIdempotencyKey, registrarEvento } from "@/lib/agent/guards";
import { redactarRecordatorio } from "@/lib/agent/composer";
import { proximoIntento } from "@/lib/agent/cadence";
import type { Seguimiento, Cuenta, Reglas } from "@/lib/supabase/types";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const force = request.nextUrl.searchParams.get("force") === "true";
    const ahora = new Date().toISOString();

    // Seguimientos activos con próximo_intento vencido (o todos si force=true)
    let query = supabase
      .from("seguimientos")
      .select("*")
      .eq("estado", "activo");

    if (!force) {
      query = query.lte("proximo_intento", ahora).not("proximo_intento", "is", null);
    }

    const { data: seguimientos } = await query;

    if (!seguimientos || seguimientos.length === 0) {
      return NextResponse.json({ ok: true, enviados: 0, borradores: 0 });
    }

    let enviados = 0;
    let borradores = 0;
    let bloqueados = 0;
    let errores = 0;
    const erroresDetalle: string[] = [];

    for (const seg of seguimientos) {
      try {
        const resultado = await procesarEnvio(seg, supabase);
        if (resultado === "enviado") enviados++;
        else if (resultado === "borrador") borradores++;
        else if (resultado === "bloqueado") bloqueados++;
      } catch (err) {
        console.error(`Error enviando para ${seg.id}:`, err);
        erroresDetalle.push(`${seg.id}: ${String(err)}`);
        errores++;
      }
    }

    return NextResponse.json({
      ok: true,
      enviados,
      borradores,
      bloqueados,
      errores,
      erroresDetalle: erroresDetalle.length > 0 ? erroresDetalle : undefined,
      total: seguimientos.length,
    });
  } catch (err) {
    console.error("Error en cron enviar:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

type ResultadoEnvio = "enviado" | "borrador" | "bloqueado" | "error";

async function procesarEnvio(
  seg: Seguimiento,
  supabase: ReturnType<typeof createServiceClient>
): Promise<ResultadoEnvio> {
  // Obtener cuenta y reglas
  const { data: cuenta } = await supabase
    .from("cuentas")
    .select("*")
    .eq("id", seg.cuenta_id)
    .single();

  if (!cuenta) return "bloqueado";

  const { data: reglas } = await supabase
    .from("reglas")
    .select("*")
    .eq("user_id", seg.user_id)
    .single();

  if (!reglas) return "bloqueado";

  // Verificar intervención manual reciente
  const gmail = await getGmailClient(seg.cuenta_id);
  const thread = await getThread(gmail, seg.thread_id);
  const mensajeManual = detectManualUserMessage(thread, seg.mensajes_vistos, cuenta.email);

  // Pasar por guardas
  const intento = seg.intentos + 1;
  const guard = await puedeEnviar({
    cuenta: cuenta as Cuenta,
    reglas: reglas as Reglas,
    seguimiento: seg,
    intento,
    tieneIntervencionManual: !!mensajeManual,
  });

  if (!guard.permitido) {
    await registrarEvento(seg.user_id, seg.id, "envio_bloqueado", {
      razon: guard.razon,
      intento,
    });
    return "bloqueado";
  }

  // Calcular escalón de tono (1-4)
  const escalon = Math.min(intento, 4);
  const diasSinRespuesta = Math.round(
    (Date.now() - new Date(seg.ultimo_envio_propio).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  // Redactar recordatorio
  const redaccion = await redactarRecordatorio({
    asunto: seg.asunto,
    objetivo: seg.objetivo ?? "una respuesta",
    destinatario: seg.destinatarios[0],
    diasSinRespuesta,
    escalon,
  });

  const claveIdempotencia = buildIdempotencyKey(seg.id, intento);

  if (guard.usarBorrador) {
    // Crear borrador
    await createDraftInThread({
      gmail,
      threadId: seg.thread_id,
      to: seg.destinatarios,
      subject: seg.asunto,
      body: redaccion.cuerpo,
      inReplyTo: seg.ultimo_message_id,
      references: seg.referencias,
    });

    // Registrar envío como borrador
    await supabase.from("envios").insert({
      user_id: seg.user_id,
      seguimiento_id: seg.id,
      tipo: "recordatorio",
      intento,
      escalon_tono: escalon,
      cuerpo: redaccion.cuerpo,
      estado: "borrador",
      clave_idempotencia: claveIdempotencia,
    });

    await registrarEvento(seg.user_id, seg.id, "borrador_creado", {
      intento,
      escalon,
    });

    return "borrador";
  }

  // Enviar
  try {
    const resultado = await sendInThread({
      gmail,
      threadId: seg.thread_id,
      to: seg.destinatarios,
      subject: seg.asunto,
      body: redaccion.cuerpo,
      inReplyTo: seg.ultimo_message_id,
      references: seg.referencias,
    });

    // Registrar envío exitoso
    await supabase.from("envios").insert({
      user_id: seg.user_id,
      seguimiento_id: seg.id,
      tipo: "recordatorio",
      intento,
      escalon_tono: escalon,
      cuerpo: redaccion.cuerpo,
      gmail_message_id: resultado.messageId,
      estado: "enviado",
      clave_idempotencia: claveIdempotencia,
    });

    // Actualizar seguimiento
    const cadencia = reglas.cadencia_dias;
    const agotado = intento >= cadencia.length;

    if (agotado) {
      // Cuarto intento sin respuesta → cerrar como agotado
      await supabase
        .from("seguimientos")
        .update({
          estado: "agotado",
          motivo_cierre: "agotado",
          intentos: intento,
          ultimo_envio_propio: new Date().toISOString(),
          proximo_intento: null,
        })
        .eq("id", seg.id);

      await registrarEvento(seg.user_id, seg.id, "seguimiento_agotado", {
        intentos: intento,
      });
    } else {
      // Calcular próximo intento
      const siguiente = await proximoIntento(new Date(), intento, reglas);

      await supabase
        .from("seguimientos")
        .update({
          intentos: intento,
          ultimo_envio_propio: new Date().toISOString(),
          ultimo_message_id: resultado.messageId,
          proximo_intento: siguiente?.toISOString() ?? null,
          mensajes_vistos: thread.totalMessages + 1,
        })
        .eq("id", seg.id);
    }

    await registrarEvento(seg.user_id, seg.id, "recordatorio_enviado", {
      intento,
      escalon,
      messageId: resultado.messageId,
    });

    return "enviado";
  } catch (err) {
    // Registrar fallo
    await supabase.from("envios").insert({
      user_id: seg.user_id,
      seguimiento_id: seg.id,
      tipo: "recordatorio",
      intento,
      escalon_tono: escalon,
      cuerpo: redaccion.cuerpo,
      estado: "fallido",
      error: String(err),
      clave_idempotencia: claveIdempotencia,
    });

    await registrarEvento(seg.user_id, seg.id, "envio_fallido", {
      intento,
      error: String(err),
    });

    return "error";
  }
}
