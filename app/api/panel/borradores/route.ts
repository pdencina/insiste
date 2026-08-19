/**
 * API Panel: Borradores
 *
 * Lista los borradores actuales en Gmail (generados por el agente).
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

    // Listar borradores
    const response = await withRetry(() =>
      gmail.users.drafts.list({ userId: "me", maxResults: 20 })
    );

    const drafts = response.data.drafts ?? [];
    const borradores: Array<{
      draftId: string;
      messageId: string;
      threadId: string;
      to: string;
      subject: string;
      snippet: string;
      body: string;
    }> = [];

    for (const draft of drafts) {
      try {
        const detail = await withRetry(() =>
          gmail.users.drafts.get({ userId: "me", id: draft.id! })
        );

        const msg = detail.data.message;
        const headers = msg?.payload?.headers ?? [];
        const to = headers.find((h) => h.name === "To")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "(sin asunto)";

        // Extraer cuerpo
        let body = "";
        const parts = msg?.payload?.parts ?? [];
        const textPart = parts.find((p) => p.mimeType === "text/plain") ?? msg?.payload;
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        }

        borradores.push({
          draftId: draft.id!,
          messageId: msg?.id ?? "",
          threadId: msg?.threadId ?? "",
          to,
          subject,
          snippet: msg?.snippet ?? "",
          body,
        });
      } catch {
        // Ignorar borradores que no se pueden leer
      }
    }

    return NextResponse.json({ ok: true, borradores });
  } catch (err) {
    console.error("Error en panel borradores:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
