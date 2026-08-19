/**
 * API Panel: Inbox
 *
 * Lista los últimos correos del inbox que podrían necesitar respuesta.
 * Filtra automáticos y notificaciones.
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

    // Listar últimos mensajes del inbox (no leídos primero, luego recientes)
    const response = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: 20,
      })
    );

    const messages = response.data.messages ?? [];
    const inbox: Array<{
      id: string;
      threadId: string;
      from: string;
      fromEmail: string;
      subject: string;
      snippet: string;
      date: string;
      unread: boolean;
      hasAttachments: boolean;
    }> = [];

    for (const msg of messages.slice(0, 15)) {
      try {
        const detail = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          })
        );

        const headers = detail.data.payload?.headers ?? [];
        const from = headers.find((h) => h.name === "From")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(sin asunto)";
        const date = headers.find((h) => h.name === "Date")?.value ?? "";
        const fromEmail = extractEmail(from);

        // Filtrar notificaciones automáticas
        if (
          fromEmail.includes("noreply") ||
          fromEmail.includes("no-reply") ||
          fromEmail.includes("notifications") ||
          fromEmail.includes("mailer-daemon")
        ) {
          continue;
        }

        const labels = detail.data.labelIds ?? [];
        const unread = labels.includes("UNREAD");
        const hasAttachments = detail.data.payload?.parts?.some(
          (p) => p.filename && p.filename.length > 0
        ) ?? false;

        inbox.push({
          id: msg.id!,
          threadId: msg.threadId!,
          from,
          fromEmail,
          subject,
          snippet: detail.data.snippet ?? "",
          date,
          unread,
          hasAttachments,
        });
      } catch {
        // Ignorar mensajes que no se pueden leer
      }
    }

    return NextResponse.json({ ok: true, inbox });
  } catch (err) {
    console.error("Error en panel inbox:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
