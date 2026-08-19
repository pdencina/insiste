/**
 * API Panel: Acciones
 *
 * Permite ejecutar acciones desde el panel:
 * - responder: Pone etiqueta insiste/responder a un hilo
 * - seguir: Pone etiqueta insiste/seguir a un hilo
 * - enviar_borrador: Envía un borrador existente
 * - descartar_borrador: Elimina un borrador
 * - pausar: Pausa un seguimiento
 * - reanudar: Reanuda un seguimiento pausado
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { addLabelToThread, ensureLabelId, LABEL_NAMES } from "@/lib/gmail/labels";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const { accion, threadId, draftId, seguimientoId } = body;

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

    switch (accion) {
      case "responder": {
        // Poner etiqueta insiste/responder al hilo
        if (!threadId) return NextResponse.json({ error: "threadId requerido" }, { status: 400 });
        await addLabelToThread(gmail, threadId, LABEL_NAMES.RESPONDER);
        return NextResponse.json({ ok: true, message: "Hilo marcado para responder. El agente generará borrador en breve." });
      }

      case "seguir": {
        // Poner etiqueta insiste/seguir al hilo
        if (!threadId) return NextResponse.json({ error: "threadId requerido" }, { status: 400 });
        await addLabelToThread(gmail, threadId, LABEL_NAMES.SEGUIR);
        return NextResponse.json({ ok: true, message: "Hilo marcado para seguimiento." });
      }

      case "enviar_borrador": {
        // Enviar un borrador
        if (!draftId) return NextResponse.json({ error: "draftId requerido" }, { status: 400 });
        const result = await withRetry(() =>
          gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } })
        );
        return NextResponse.json({ ok: true, message: "Borrador enviado.", messageId: result.data.id });
      }

      case "descartar_borrador": {
        // Eliminar un borrador
        if (!draftId) return NextResponse.json({ error: "draftId requerido" }, { status: 400 });
        await withRetry(() =>
          gmail.users.drafts.delete({ userId: "me", id: draftId })
        );
        return NextResponse.json({ ok: true, message: "Borrador descartado." });
      }

      case "pausar": {
        if (!seguimientoId) return NextResponse.json({ error: "seguimientoId requerido" }, { status: 400 });
        await supabase
          .from("seguimientos")
          .update({ estado: "pausado", motivo_pausa: "Manual desde panel" })
          .eq("id", seguimientoId);
        return NextResponse.json({ ok: true, message: "Seguimiento pausado." });
      }

      case "reanudar": {
        if (!seguimientoId) return NextResponse.json({ error: "seguimientoId requerido" }, { status: 400 });
        await supabase
          .from("seguimientos")
          .update({ estado: "activo", motivo_pausa: null })
          .eq("id", seguimientoId);
        return NextResponse.json({ ok: true, message: "Seguimiento reanudado." });
      }

      default:
        return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 });
    }
  } catch (err) {
    console.error("Error en panel acciones:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
