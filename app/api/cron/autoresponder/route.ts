/**
 * Cron: Autoresponder (cada 5 min)
 *
 * Procesa automáticamente todo el inbox:
 * - Detecta correos nuevos que necesitan respuesta
 * - Filtra automáticos/newsletters
 * - Lee la cadena completa del hilo
 * - Genera respuesta con el estilo aprendido del usuario
 * - Crea borrador (o envía directo según config)
 *
 * Solo procesa hilos donde el último mensaje NO es del usuario.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { getThread, getMessageBody } from "@/lib/gmail/threads";
import { createDraftInThread } from "@/lib/gmail/drafts";
import { sendInThread } from "@/lib/gmail/send";
import { extractEmail } from "@/lib/gmail/headers";
import { generarRespuesta } from "@/lib/agent/responder";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const { data: cuenta } = await supabase
      .from("cuentas")
      .select("*")
      .eq("estado", "activa")
      .eq("envio_habilitado", true)
      .limit(1)
      .single();

    if (!cuenta) {
      return NextResponse.json({ ok: true, procesados: 0, msg: "No hay cuenta activa" });
    }

    const gmail = await getGmailClient(cuenta.id);
    const miEmail = cuenta.email.toLowerCase();

    // Leer config para saber si enviar directo o borrador
    const { data: configData } = await supabase
      .from("eventos")
      .select("detalle")
      .eq("accion", "agent_config")
      .order("creado_en", { ascending: false })
      .limit(1)
      .single();

    const soloBorradores = configData?.detalle?.reglas?.solo_borradores ?? true;

    // Obtener últimos hilos del inbox
    const response = await withRetry(() =>
      gmail.users.threads.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 20,
        q: "is:unread", // Solo no leídos para no reprocesar
      })
    );

    const threads = response.data.threads ?? [];

    let procesados = 0;
    let filtrados = 0;
    let errores = 0;
    const erroresDetalle: string[] = [];

    for (const threadRef of threads) {
      try {
        const thread = await getThread(gmail, threadRef.id!);
        if (thread.messages.length === 0) continue;

        // Obtener último mensaje
        const ultimoMsg = thread.messages[thread.messages.length - 1];
        const from = ultimoMsg.headers.from ?? "";
        const fromEmail = extractEmail(from);
        const subject = ultimoMsg.headers.subject ?? thread.messages[0].headers.subject ?? "";

        // Si el último mensaje es mío, skip
        if (fromEmail === miEmail) continue;

        // Filtrar automáticos
        if (esAutomatico(fromEmail, subject)) {
          filtrados++;
          continue;
        }

        // Verificar que no hayamos procesado ya este hilo (buscar en envios recientes)
        const { data: yaRespondido } = await supabase
          .from("eventos")
          .select("id")
          .eq("user_id", cuenta.user_id)
          .eq("accion", "autorespuesta")
          .eq("detalle->>threadId", threadRef.id!)
          .limit(1);

        if (yaRespondido && yaRespondido.length > 0) continue;

        // Construir cadena completa del hilo
        const cadenaCompleta = await buildCadena(gmail, thread, miEmail);

        // Obtener cuerpo del último mensaje
        const ultimoCuerpo = await getMessageBody(gmail, ultimoMsg.id, 3000);

        // Determinar destinatarios del reply
        let destinatarios: string[] = [fromEmail];
        if (ultimoMsg.headers.to) {
          const otrosTo = ultimoMsg.headers.to
            .split(",")
            .map((part) => {
              const match = part.match(/<([^>]+)>/);
              return match ? match[1].toLowerCase() : part.trim().toLowerCase();
            })
            .filter((e) => e && e !== miEmail && e !== fromEmail && e.includes("@"));
          destinatarios.push(...otrosTo);
        }

        // Extraer CC del hilo
        const ccSet = new Set<string>();
        for (const msg of thread.messages) {
          if (msg.headers.cc) {
            msg.headers.cc.split(",").forEach((part) => {
              const match = part.match(/<([^>]+)>/);
              const email = match ? match[1].toLowerCase() : part.trim().toLowerCase();
              if (email && email !== miEmail && !destinatarios.includes(email) && email.includes("@")) {
                ccSet.add(email);
              }
            });
          }
        }
        const cc = Array.from(ccSet);

        // Generar respuesta con IA
        const respuesta = await generarRespuesta({
          cadenaCompleta,
          ultimoMensaje: ultimoCuerpo,
          remitente: fromEmail,
          asunto: subject,
          tieneAdjuntos: ultimoMsg.hasAttachments,
          destinatarios,
        });

        if (soloBorradores) {
          // Crear borrador
          await createDraftInThread({
            gmail,
            threadId: threadRef.id!,
            to: destinatarios,
            cc: cc.length > 0 ? cc : undefined,
            subject,
            body: respuesta.cuerpo,
            inReplyTo: ultimoMsg.headers.messageId ?? ultimoMsg.id,
            references: ultimoMsg.headers.references,
          });
        } else {
          // Enviar directo
          await sendInThread({
            gmail,
            threadId: threadRef.id!,
            to: destinatarios,
            subject,
            body: respuesta.cuerpo,
            inReplyTo: ultimoMsg.headers.messageId ?? ultimoMsg.id,
            references: ultimoMsg.headers.references,
          });
        }

        // Registrar que procesamos este hilo
        await supabase.from("eventos").insert({
          user_id: cuenta.user_id,
          accion: "autorespuesta",
          detalle: {
            threadId: threadRef.id!,
            asunto: subject,
            remitente: fromEmail,
            destinatarios,
            modo: soloBorradores ? "borrador" : "enviado",
            tratamiento: respuesta.tratamiento,
          },
        });

        // Marcar como leído si enviamos directo
        if (!soloBorradores) {
          await withRetry(() =>
            gmail.users.threads.modify({
              userId: "me",
              id: threadRef.id!,
              requestBody: { removeLabelIds: ["UNREAD"] },
            })
          );
        }

        procesados++;
      } catch (err) {
        errores++;
        erroresDetalle.push(`${threadRef.id}: ${String(err)}`);
        console.error(`Error autoresponder hilo ${threadRef.id}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      procesados,
      filtrados,
      errores,
      erroresDetalle: erroresDetalle.length > 0 ? erroresDetalle : undefined,
      modo: soloBorradores ? "borradores" : "envio_directo",
    });
  } catch (err) {
    console.error("Error en cron autoresponder:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Construye la cadena completa del hilo formateada.
 */
async function buildCadena(
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

    const cuerpo = await getMessageBody(gmail, msg.id, 2000);

    partes.push(
      `[${fecha}] ${esMio ? "YO (Pablo)" : from}:\n${cuerpo || msg.snippet}\n`
    );
  }

  return partes.join("\n---\n\n");
}

/**
 * Detecta correos automáticos que no requieren respuesta.
 */
function esAutomatico(fromEmail: string, subject: string): boolean {
  const emailsAuto = [
    "noreply", "no-reply", "notifications", "mailer-daemon",
    "postmaster", "calendar-notification", "notify",
    "donotreply", "automated", "alerts", "newsletter",
    "marketing", "promo", "info@", "hello@", "team@",
    "support@", "billing@", "changelog",
  ];

  const dominiosAuto = [
    "github.com", "gitlab.com", "asana.com", "trello.com",
    "slack.com", "google.com", "calendar.google.com",
    "docs.google.com", "vercel.com", "supabase.io",
    "supabase.com", "dataddo.com", "neon.tech",
    "zoom.us", "e.zoom.us", "canva.com", "engage.canva.com",
    "blackdrop.cl", "mailchimp.com", "sendgrid.net",
    "hubspot.com", "intercom.io", "crisp.chat",
    "notion.so", "linear.app", "figma.com",
    "stripe.com", "paypal.com", "mercadopago.com",
    "clarovtr.cl", "e.clarovtr.cl",
  ];

  const subjectPatterns = [
    /invitaci[oó]n.*calendar/i,
    /invitaci[oó]n:.*\d{4}/i,
    /^\[GitHub\]/i,
    /has been (assigned|updated|created)/i,
    /tienes.*notificaciones/i,
    /your.*is going to be/i,
    /new (comment|task|issue)/i,
    /reminder:/i,
    /auto-?reply/i,
    /out of office/i,
    /fuera de oficina/i,
    /unsubscribe/i,
    /newsletter/i,
    /te hemos echado de menos/i,
    /new in/i,
    /ahorre.*%/i,
    /descuento/i,
    /oferta/i,
    /promo/i,
  ];

  if (emailsAuto.some((e) => fromEmail.includes(e))) return true;
  if (dominiosAuto.some((d) => fromEmail.endsWith(`@${d}`) || fromEmail.includes(`.${d}`))) return true;
  if (subjectPatterns.some((p) => p.test(subject))) return true;

  return false;
}
