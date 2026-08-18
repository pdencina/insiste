/**
 * Cron: Sincronizar (cada 10 min)
 *
 * Revisa todos los seguimientos activos, detecta mensajes nuevos de la
 * contraparte, los clasifica y ejecuta la acción correspondiente.
 *
 * Este cron NO envía recordatorios — solo detecta y clasifica respuestas.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { getThread, detectNewCounterpartyMessages, detectManualUserMessage, getMessageBody } from "@/lib/gmail/threads";
import { classifyByHeaders, parseHeaders, extractEmail } from "@/lib/gmail/headers";
import { clasificarMensaje } from "@/lib/agent/classifier";
import { determinarAccion, ACCIONES } from "@/lib/agent/actions";
import { reprogramarPorPromesa, proximoIntento } from "@/lib/agent/cadence";
import { swapLabel, LABEL_NAMES } from "@/lib/gmail/labels";
import { createDraftInThread } from "@/lib/gmail/drafts";
import { sendInThread } from "@/lib/gmail/send";
import { generarAcuseRecibo } from "@/lib/agent/composer";
import { registrarEvento } from "@/lib/agent/guards";
import type { Seguimiento, Reglas } from "@/lib/supabase/types";

export async function GET(request: NextRequest) {
  // Validar secreto del cron
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // Obtener seguimientos activos
    const { data: seguimientos, error } = await supabase
      .from("seguimientos")
      .select("*")
      .eq("estado", "activo");

    if (error || !seguimientos) {
      return NextResponse.json({ error: "Error leyendo seguimientos" }, { status: 500 });
    }

    let procesados = 0;
    let errores = 0;

    for (const seg of seguimientos) {
      try {
        await procesarSeguimiento(seg, supabase);
        procesados++;
      } catch (err) {
        console.error(`Error procesando seguimiento ${seg.id}:`, err);
        errores++;
      }
    }

    return NextResponse.json({
      ok: true,
      procesados,
      errores,
      total: seguimientos.length,
    });
  } catch (err) {
    console.error("Error en cron sincronizar:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function procesarSeguimiento(
  seg: Seguimiento,
  supabase: ReturnType<typeof createServiceClient>
) {
  // Obtener cuenta y reglas
  const { data: cuenta } = await supabase
    .from("cuentas")
    .select("*")
    .eq("id", seg.cuenta_id)
    .single();

  if (!cuenta || cuenta.estado !== "activa") return;

  const { data: reglas } = await supabase
    .from("reglas")
    .select("*")
    .eq("user_id", seg.user_id)
    .single();

  if (!reglas) return;

  // Obtener hilo de Gmail
  const gmail = await getGmailClient(seg.cuenta_id);
  const thread = await getThread(gmail, seg.thread_id);

  // Detectar si el usuario intervino manualmente
  const mensajeManual = detectManualUserMessage(thread, seg.mensajes_vistos, cuenta.email);
  if (mensajeManual) {
    // El usuario escribió — reiniciar cadencia
    const nuevoProximoIntento = await proximoIntento(
      new Date(mensajeManual.internalDate),
      0, // Resetear al escalón 0
      reglas
    );

    await supabase
      .from("seguimientos")
      .update({
        ultimo_envio_propio: new Date(mensajeManual.internalDate).toISOString(),
        ultimo_message_id: mensajeManual.headers.messageId ?? seg.ultimo_message_id,
        mensajes_vistos: thread.totalMessages,
        intentos: 0,
        proximo_intento: nuevoProximoIntento?.toISOString() ?? null,
      })
      .eq("id", seg.id);

    await registrarEvento(seg.user_id, seg.id, "intervencion_manual", {
      messageId: mensajeManual.id,
    });

    return;
  }

  // Detectar mensajes nuevos de la contraparte
  const nuevos = detectNewCounterpartyMessages(thread, seg.mensajes_vistos, cuenta.email);
  if (nuevos.length === 0) return;

  // Procesar cada mensaje nuevo (normalmente es 1)
  for (const msg of nuevos) {
    // Registrar el mensaje
    const { data: msgDb } = await supabase
      .from("mensajes_hilo")
      .insert({
        user_id: seg.user_id,
        seguimiento_id: seg.id,
        gmail_message_id: msg.id,
        rfc_message_id: msg.headers.messageId,
        direccion: "contraparte",
        remitente: msg.headers.from,
        extracto: msg.snippet.substring(0, 300),
        tiene_adjuntos: msg.hasAttachments,
        recibido_en: new Date(msg.internalDate).toISOString(),
      })
      .select("id")
      .single();

    if (!msgDb) continue;

    // Clasificar: primero por headers
    const headerClassification = classifyByHeaders(msg.headers);

    let clase = headerClassification.clase;
    let confianza = 1.0;
    let razon = headerClassification.razon ?? "";
    let fechaPrometida: string | null = null;
    let porHeaders = true;
    let modelo: string | null = null;

    if (!clase) {
      // No es automático ni rebote → clasificar con LLM
      porHeaders = false;
      const body = await getMessageBody(gmail, msg.id);

      const result = await clasificarMensaje({
        objetivo: seg.objetivo ?? "Obtener una respuesta",
        textoMensaje: body,
        remitente: msg.headers.from ?? "desconocido",
        tieneAdjuntos: msg.hasAttachments,
        asuntoHilo: seg.asunto,
      });

      clase = result.clase;
      confianza = result.confianza;
      razon = result.razon;
      fechaPrometida = result.fecha_prometida;
      modelo = result.modelo;
    }

    // Registrar clasificación
    await supabase.from("clasificaciones").insert({
      user_id: seg.user_id,
      seguimiento_id: seg.id,
      mensaje_id: msgDb.id,
      clase,
      confianza,
      razon,
      fecha_prometida: fechaPrometida,
      por_headers: porHeaders,
      modelo,
    });

    // Determinar acción
    const accion = determinarAccion(clase, confianza, reglas.umbral_confianza);

    // Ejecutar la acción
    await ejecutarAccion(accion, seg, reglas, cuenta, gmail, msg, fechaPrometida, supabase);
  }

  // Actualizar mensajes_vistos
  await supabase
    .from("seguimientos")
    .update({ mensajes_vistos: thread.totalMessages })
    .eq("id", seg.id);
}

async function ejecutarAccion(
  accion: ReturnType<typeof determinarAccion>,
  seg: Seguimiento,
  reglas: Reglas,
  cuenta: { email: string; id: string },
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  msg: { id: string; headers: { messageId: string | null; from: string | null } },
  fechaPrometida: string | null,
  supabase: ReturnType<typeof createServiceClient>
) {
  const updates: Partial<Seguimiento> = {};

  // Cambiar estado
  if (accion.nuevoEstado !== seg.estado) {
    updates.estado = accion.nuevoEstado;

    if (accion.motivoCierre) {
      updates.motivo_cierre = accion.motivoCierre;
    }

    if (accion.nuevoEstado === "pausado") {
      updates.motivo_pausa = accion.descripcion;
    }
  }

  // Reiniciar reloj (promesa)
  if (accion.reiniciaReloj && fechaPrometida) {
    const nuevaFecha = await reprogramarPorPromesa(new Date(fechaPrometida), reglas);
    updates.proximo_intento = nuevaFecha.toISOString();
  }

  // Enviar acuse
  if (accion.enviarAcuse && reglas.acuse_automatico) {
    try {
      const cuerpoAcuse = generarAcuseRecibo(seg.objetivo ?? "");
      await sendInThread({
        gmail,
        threadId: seg.thread_id,
        to: seg.destinatarios,
        subject: seg.asunto,
        body: cuerpoAcuse,
        inReplyTo: msg.headers.messageId ?? seg.ultimo_message_id,
        references: seg.referencias,
      });
    } catch (err) {
      console.error(`Error enviando acuse para ${seg.id}:`, err);
    }
  }

  // Crear borrador (pregunta)
  if (accion.crearBorrador) {
    try {
      await createDraftInThread({
        gmail,
        threadId: seg.thread_id,
        to: seg.destinatarios,
        subject: seg.asunto,
        body: "[Tu respuesta aquí — el agente detectó una pregunta que requiere tu intervención]",
        inReplyTo: msg.headers.messageId ?? seg.ultimo_message_id,
        references: seg.referencias,
      });
    } catch (err) {
      console.error(`Error creando borrador para ${seg.id}:`, err);
    }
  }

  // Cambiar etiqueta si se cerró
  if (accion.nuevoEstado === "cerrado") {
    try {
      await swapLabel(gmail, seg.thread_id, LABEL_NAMES.ACTIVO, LABEL_NAMES.CERRADO);
    } catch (err) {
      console.error(`Error cambiando etiqueta para ${seg.id}:`, err);
    }
  }

  // Aplicar updates
  if (Object.keys(updates).length > 0) {
    await supabase.from("seguimientos").update(updates).eq("id", seg.id);
  }

  // Registrar evento
  await registrarEvento(seg.user_id, seg.id, "clasificacion_procesada", {
    accion: accion.descripcion,
    nuevoEstado: accion.nuevoEstado,
  });
}
