/**
 * Cron: Responder (cada 5 min)
 *
 * Busca hilos con etiqueta `insiste/responder`, lee la cadena completa,
 * genera una respuesta inteligente con IA, y la deja como borrador.
 * Luego quita la etiqueta para no volver a procesarlo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { getThread, listThreadsByLabel, getMessageBody } from "@/lib/gmail/threads";
import { ensureLabelId, removeLabelFromThread, LABEL_NAMES } from "@/lib/gmail/labels";
import { createDraftInThread } from "@/lib/gmail/drafts";
import { extractEmail } from "@/lib/gmail/headers";
import { generarRespuesta } from "@/lib/agent/responder";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // Obtener cuentas activas
    const { data: cuentas } = await supabase
      .from("cuentas")
      .select("*")
      .eq("estado", "activa")
      .eq("envio_habilitado", true);

    if (!cuentas || cuentas.length === 0) {
      return NextResponse.json({ ok: true, respondidos: 0 });
    }

    let totalRespondidos = 0;
    let totalErrores = 0;
    const erroresDetalle: string[] = [];

    for (const cuenta of cuentas) {
      try {
        const gmail = await getGmailClient(cuenta.id);

        // Obtener label ID de insiste/responder
        const labelId = await ensureLabelId(gmail, LABEL_NAMES.RESPONDER);

        // Listar hilos con esa etiqueta
        const threadIds = await listThreadsByLabel(gmail, labelId);

        for (const threadId of threadIds) {
          try {
            const respondido = await procesarHiloRespuesta(
              threadId,
              cuenta,
              gmail
            );
            if (respondido) totalRespondidos++;
          } catch (err) {
            console.error(`Error respondiendo hilo ${threadId}:`, err);
            erroresDetalle.push(`${threadId}: ${String(err)}`);
            totalErrores++;
          }
        }
      } catch (err) {
        console.error(`Error procesando cuenta ${cuenta.id}:`, err);
        erroresDetalle.push(`cuenta ${cuenta.id}: ${String(err)}`);
        totalErrores++;
      }
    }

    return NextResponse.json({
      ok: true,
      respondidos: totalRespondidos,
      errores: totalErrores,
      erroresDetalle: erroresDetalle.length > 0 ? erroresDetalle : undefined,
    });
  } catch (err) {
    console.error("Error en cron responder:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function procesarHiloRespuesta(
  threadId: string,
  cuenta: { id: string; user_id: string; email: string },
  gmail: Awaited<ReturnType<typeof getGmailClient>>
): Promise<boolean> {
  // Obtener el hilo completo
  const thread = await getThread(gmail, threadId);
  if (thread.messages.length === 0) return false;

  const emailNormalizado = cuenta.email.toLowerCase();

  // Obtener el último mensaje (el que hay que responder)
  const ultimoMsg = thread.messages[thread.messages.length - 1];

  // Determinar el remitente del último mensaje
  const remitente = ultimoMsg.headers.from
    ? extractEmail(ultimoMsg.headers.from)
    : "desconocido";

  // Determinar destinatarios del reply
  // Si el último mensaje es de alguien más, responder a esa persona
  // Si el último mensaje es mío, responder al destinatario original
  let destinatarios: string[];
  let cc: string[] = [];

  if (remitente !== emailNormalizado) {
    destinatarios = [remitente];
    // Agregar otros destinatarios del To (excepto yo)
    if (ultimoMsg.headers.to) {
      const otrosTo = ultimoMsg.headers.to
        .split(",")
        .map((part) => {
          const match = part.match(/<([^>]+)>/);
          return match ? match[1].toLowerCase() : part.trim().toLowerCase();
        })
        .filter((e) => e && e !== emailNormalizado && e !== remitente && e.includes("@"));
      destinatarios.push(...otrosTo);
    }
  } else {
    // El último mensaje es mío — responder al To original
    destinatarios = ultimoMsg.headers.to
      ? ultimoMsg.headers.to
          .split(",")
          .map((part) => {
            const match = part.match(/<([^>]+)>/);
            return match ? match[1].toLowerCase() : part.trim().toLowerCase();
          })
          .filter((e) => e && e !== emailNormalizado && e.includes("@"))
      : [];
  }

  // Extraer CC de la cadena (todos los que aparecen en CC en cualquier mensaje)
  const ccSet = new Set<string>();
  for (const msg of thread.messages) {
    if (msg.headers.cc) {
      msg.headers.cc.split(",").forEach((part) => {
        const match = part.match(/<([^>]+)>/);
        const email = match ? match[1].toLowerCase() : part.trim().toLowerCase();
        if (email && email !== emailNormalizado && !destinatarios.includes(email) && email.includes("@")) {
          ccSet.add(email);
        }
      });
    }
  }
  cc = Array.from(ccSet);

  if (destinatarios.length === 0) return false;

  // Leer el cuerpo completo de todos los mensajes del hilo
  const cadenaCompleta = await buildCadenaCompleta(gmail, thread, emailNormalizado);

  // Leer el cuerpo del último mensaje
  const ultimoMensajeCuerpo = await getMessageBody(gmail, ultimoMsg.id, 3000);

  // Generar respuesta con IA
  const respuesta = await generarRespuesta({
    cadenaCompleta,
    ultimoMensaje: ultimoMensajeCuerpo,
    remitente,
    asunto: ultimoMsg.headers.subject ?? thread.messages[0].headers.subject ?? "(sin asunto)",
    tieneAdjuntos: ultimoMsg.hasAttachments,
    destinatarios,
  });

  // Crear borrador
  await createDraftInThread({
    gmail,
    threadId,
    to: destinatarios,
    cc: cc.length > 0 ? cc : undefined,
    subject: ultimoMsg.headers.subject ?? thread.messages[0].headers.subject ?? "(sin asunto)",
    body: respuesta.cuerpo,
    inReplyTo: ultimoMsg.headers.messageId ?? ultimoMsg.id,
    references: ultimoMsg.headers.references,
  });

  // Quitar la etiqueta insiste/responder para no procesarlo de nuevo
  await removeLabelFromThread(gmail, threadId, LABEL_NAMES.RESPONDER);

  return true;
}

/**
 * Construye la cadena completa del hilo formateada para el LLM.
 */
async function buildCadenaCompleta(
  gmail: Awaited<ReturnType<typeof getGmailClient>>,
  thread: Awaited<ReturnType<typeof getThread>>,
  emailPropio: string
): Promise<string> {
  const partes: string[] = [];

  for (const msg of thread.messages) {
    const from = msg.headers.from ?? "desconocido";
    const fromEmail = extractEmail(from);
    const esMio = fromEmail === emailPropio;
    const fecha = new Date(msg.internalDate).toLocaleString("es-CL", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    // Leer cuerpo (limitado para no exceder contexto)
    const cuerpo = await getMessageBody(gmail, msg.id, 2000);

    partes.push(
      `[${fecha}] ${esMio ? "YO (Pablo)" : from}:\n${cuerpo || msg.snippet}\n`
    );
  }

  return partes.join("\n---\n\n");
}
