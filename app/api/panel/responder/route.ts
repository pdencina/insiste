/**
 * API Panel: enviar por WhatsApp una respuesta aprobada por Pablo.
 *
 * GET  /api/panel/responder            → ¿está lista la configuración en Kommo? (campo + Salesbot)
 * POST /api/panel/responder { leadId, texto } → guarda el texto en el lead y lanza el
 *      Salesbot "Enviar respuesta Insiste" (ver lib/kommo/enviar.ts). Solo dentro de la
 *      ventana de 24 h de WhatsApp.
 */

import { NextRequest, NextResponse } from "next/server";
import { verificarPanel } from "@/lib/panel/sesion";
import { enviarRespuesta, estadoConfiguracion } from "@/lib/kommo/enviar";
import { createServiceClient } from "@/lib/supabase/client";

export const maxDuration = 60;

function autorizado(request: NextRequest) {
  const s = verificarPanel(request);
  return s === "puente-alto" || s === "admin";
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await estadoConfiguracion()) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { leadId, texto } = await request.json();
    const id = Number(leadId);
    if (!id || typeof texto !== "string") {
      return NextResponse.json({ error: "Faltan leadId o texto" }, { status: 400 });
    }
    await enviarRespuesta(id, texto);

    // Registro (auditoría de lo enviado desde el panel)
    const supabase = createServiceClient();
    const { data: cuenta } = await supabase.from("cuentas").select("user_id").eq("estado", "activa").limit(1).single();
    if (cuenta) {
      await supabase.from("eventos").insert({
        user_id: cuenta.user_id,
        accion: "respuesta_insiste_enviada",
        detalle: { leadId: id, texto: texto.trim(), enviadoEn: Math.floor(Date.now() / 1000) },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err).replace(/^Error: /, "") }, { status: 400 });
  }
}
