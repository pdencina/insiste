/**
 * API Panel: Inbox Inteligente
 *
 * Muestra hilos donde el usuario NO fue el último en responder.
 * Filtra automáticos (newsletters, notificaciones, calendarios).
 * Ordena por antigüedad (más días sin respuesta primero).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { extractEmail } from "@/lib/gmail/headers";

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
      .limit(1)
      .single();

    if (!cuenta) {
      return NextResponse.json({ error: "No hay cuenta activa" }, { status: 400 });
    }

    const gmail = await getGmailClient(cuenta.id);
    const miEmail = cuenta.email.toLowerCase();

    // Buscar hilos recientes del inbox (últimos 50)
    const response = await withRetry(() =>
      gmail.users.threads.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 50,
      })
    );

    const threads = response.data.threads ?? [];
    const pendientes: Array<{
      id: string;
      threadId: string;
      from: string;
      fromEmail: string;
      subject: string;
      snippet: string;
      lastDate: string;
      diasSinResponder: number;
      unread: boolean;
      hasAttachments: boolean;
      participantes: number;
    }> = [];

    // Procesar cada hilo para ver si estamos pendientes de responder
    for (const thread of threads) {
      try {
        const detail = await withRetry(() =>
          gmail.users.threads.get({
            userId: "me",
            id: thread.id!,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          })
        );

        const messages = detail.data.messages ?? [];
        if (messages.length === 0) continue;

        // Obtener el último mensaje del hilo
        const ultimoMsg = messages[messages.length - 1];
        const headers = ultimoMsg.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
        const fromEmail = extractEmail(from);

        // Filtrar: si el último mensaje es MÍO, no estoy pendiente
        if (fromEmail === miEmail) continue;

        // Filtrar automáticos y newsletters
        if (esAutomatico(fromEmail, subject)) continue;

        // Calcular días sin responder
        const internalDate = parseInt(ultimoMsg.internalDate ?? "0", 10);
        const diasSinResponder = Math.floor(
          (Date.now() - internalDate) / (1000 * 60 * 60 * 24)
        );

        // Solo mostrar si tiene al menos unas horas (no los de hace 5 min)
        if (diasSinResponder < 0) continue;

        const labels = ultimoMsg.labelIds ?? [];
        const unread = labels.includes("UNREAD");
        const hasAttachments = ultimoMsg.payload?.parts?.some(
          (p) => p.filename && p.filename.length > 0
        ) ?? false;

        pendientes.push({
          id: ultimoMsg.id!,
          threadId: thread.id!,
          from,
          fromEmail,
          subject: subject || "(sin asunto)",
          snippet: ultimoMsg.snippet ?? "",
          lastDate: new Date(internalDate).toISOString(),
          diasSinResponder,
          unread,
          hasAttachments,
          participantes: messages.length,
        });
      } catch {
        // Ignorar hilos que no se pueden leer
      }
    }

    // Ordenar por días sin responder (más viejo primero)
    pendientes.sort((a, b) => b.diasSinResponder - a.diasSinResponder);

    return NextResponse.json({
      ok: true,
      inbox: pendientes,
      total: pendientes.length,
    });
  } catch (err) {
    console.error("Error en panel inbox:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Detecta correos automáticos que no requieren respuesta.
 */
function esAutomatico(fromEmail: string, subject: string): boolean {
  const emailsAuto = [
    "noreply", "no-reply", "notifications", "mailer-daemon",
    "postmaster", "calendar-notification", "notify",
    "donotreply", "automated", "alerts",
  ];

  const dominiosAuto = [
    "github.com", "gitlab.com", "asana.com", "trello.com",
    "slack.com", "google.com", "calendar.google.com",
    "docs.google.com", "vercel.com", "supabase.io",
    "supabase.com", "dataddo.com",
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
  ];

  // Check email patterns
  if (emailsAuto.some((e) => fromEmail.includes(e))) return true;

  // Check domains
  if (dominiosAuto.some((d) => fromEmail.endsWith(`@${d}`) || fromEmail.includes(`.${d}`))) return true;

  // Check subject patterns
  if (subjectPatterns.some((p) => p.test(subject))) return true;

  return false;
}
