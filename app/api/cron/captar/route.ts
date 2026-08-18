/**
 * Cron: Captar (cada 15 min)
 *
 * Busca hilos con etiqueta `insiste/seguir` y los importa como seguimientos.
 * Intercambia la etiqueta por `insiste/activo`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { getThread, listThreadsByLabel } from "@/lib/gmail/threads";
import { ensureLabelId, swapLabel, LABEL_NAMES } from "@/lib/gmail/labels";
import { extractEmail } from "@/lib/gmail/headers";
import { proximoIntento } from "@/lib/agent/cadence";
import { registrarEvento } from "@/lib/agent/guards";
import type { Reglas } from "@/lib/supabase/types";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // Obtener todas las cuentas activas
    const { data: cuentas } = await supabase
      .from("cuentas")
      .select("*")
      .eq("estado", "activa");

    if (!cuentas || cuentas.length === 0) {
      return NextResponse.json({ ok: true, captados: 0 });
    }

    let totalCaptados = 0;

    for (const cuenta of cuentas) {
      try {
        const gmail = await getGmailClient(cuenta.id);

        // Obtener label ID de insiste/seguir
        const labelId = await ensureLabelId(gmail, LABEL_NAMES.SEGUIR);

        // Listar hilos con esa etiqueta
        const threadIds = await listThreadsByLabel(gmail, labelId);

        // Obtener reglas del usuario
        const { data: reglas } = await supabase
          .from("reglas")
          .select("*")
          .eq("user_id", cuenta.user_id)
          .single();

        if (!reglas) continue;

        for (const threadId of threadIds) {
          try {
            const captado = await captarHilo(
              threadId,
              cuenta,
              reglas,
              gmail,
              supabase
            );
            if (captado) totalCaptados++;
          } catch (err) {
            console.error(`Error captando hilo ${threadId}:`, err);
          }
        }
      } catch (err) {
        console.error(`Error procesando cuenta ${cuenta.id}:`, err);
      }
    }

    return NextResponse.json({ ok: true, captados: totalCaptados });
  } catch (err) {
    console.error("Error en cron captar:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function captarHilo(
  threadId: string,
  cuenta: { id: string; user_id: string; email: string },
  reglas: Reglas,
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<boolean> {
  // Verificar que no existe ya
  const { data: existente } = await supabase
    .from("seguimientos")
    .select("id")
    .eq("user_id", cuenta.user_id)
    .eq("thread_id", threadId)
    .limit(1);

  if (existente && existente.length > 0) {
    // Ya existe — solo cambiar etiqueta
    await swapLabel(gmail, threadId, LABEL_NAMES.SEGUIR, LABEL_NAMES.ACTIVO);
    return false;
  }

  // Obtener info del hilo
  const thread = await getThread(gmail, threadId);
  if (thread.messages.length === 0) return false;

  // Encontrar el último mensaje propio
  const emailNormalizado = cuenta.email.toLowerCase();
  const mensajesPropios = thread.messages.filter((msg) => {
    const from = msg.headers.from;
    if (!from) return false;
    return extractEmail(from) === emailNormalizado;
  });

  if (mensajesPropios.length === 0) {
    // El usuario no es remitente en este hilo — descartar
    return false;
  }

  const ultimoPropio = mensajesPropios[mensajesPropios.length - 1];

  // Verificar que el último mensaje propio es más reciente que cualquier
  // respuesta de la contraparte (requerimiento 1.6)
  const ultimoMensajeGlobal = thread.messages[thread.messages.length - 1];
  const esUltimoElPropio =
    ultimoPropio.internalDate >= ultimoMensajeGlobal.internalDate - 1000;

  // Extraer destinatarios (To del último mensaje propio)
  const destinatarios = extraerDestinatarios(
    ultimoPropio.headers.to ?? "",
    emailNormalizado
  );

  // Calcular próximo intento
  const primerIntento = await proximoIntento(
    new Date(ultimoPropio.internalDate),
    0,
    reglas
  );

  // Crear seguimiento
  const { error: insertError } = await supabase.from("seguimientos").insert({
    user_id: cuenta.user_id,
    cuenta_id: cuenta.id,
    thread_id: threadId,
    asunto: ultimoPropio.headers.subject ?? "(sin asunto)",
    destinatarios,
    objetivo: null, // Se infiere después o lo edita el usuario
    estado: "activo",
    intentos: 0,
    ultimo_envio_propio: new Date(ultimoPropio.internalDate).toISOString(),
    ultimo_message_id: ultimoPropio.headers.messageId ?? ultimoPropio.id,
    referencias: ultimoPropio.headers.references,
    proximo_intento: primerIntento?.toISOString() ?? null,
    mensajes_vistos: thread.totalMessages,
  });

  if (insertError) {
    console.error(`Error insertando seguimiento para thread ${threadId}:`, insertError);
    return false;
  }

  // Intercambiar etiqueta
  await swapLabel(gmail, threadId, LABEL_NAMES.SEGUIR, LABEL_NAMES.ACTIVO);

  // Registrar evento
  await registrarEvento(cuenta.user_id, null, "hilo_captado", {
    threadId,
    asunto: ultimoPropio.headers.subject,
    destinatarios,
  });

  return true;
}

/**
 * Extrae emails de destinatarios del header To, excluyendo la cuenta propia.
 */
function extraerDestinatarios(toHeader: string, propioEmail: string): string[] {
  // Puede ser "Juan <juan@x.com>, Maria <maria@x.com>"
  const emails = toHeader
    .split(",")
    .map((part) => {
      const match = part.match(/<([^>]+)>/);
      return match ? match[1].toLowerCase() : part.trim().toLowerCase();
    })
    .filter((email) => email && email !== propioEmail && email.includes("@"));

  return emails.length > 0 ? emails : [toHeader.trim()];
}
