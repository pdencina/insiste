/**
 * API Panel: WhatsApp Alerts
 *
 * Devuelve las conversaciones abiertas en Kommo con su countdown
 * de la ventana de 24h de WhatsApp, más los chats que llegaron a
 * "Incoming leads" y nadie aceptó todavía.
 */

import { NextRequest, NextResponse } from "next/server";
import { verificarPanel } from "@/lib/panel/sesion";
import { getConversacionesAbiertas, calcularResumen, getSinClasificar } from "@/lib/kommo/client";
import { getMensajesPorLead, type MensajeKommo } from "@/lib/kommo/mensajes";

// Kommo pagina de a 250 y el reporte/panel hace varias lecturas: dar margen
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Sesión de sede firmada (x-sede-token) o admin (Bearer CRON_SECRET)
  if (!verificarPanel(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [conversaciones, sinClasificar] = await Promise.all([
      getConversacionesAbiertas(),
      // Si falla, el panel sigue funcionando sin esta alerta
      getSinClasificar().catch((err) => {
        console.error("Error obteniendo chats sin aceptar:", err);
        return { recientes: [], antiguos: 0 };
      }),
    ]);
    const resumen = calcularResumen(conversaciones);

    // Texto de los últimos mensajes (llega por el webhook de Kommo); si falla, el panel sigue sin textos
    const leadIds = conversaciones.map((c) => c.leadId).filter((id): id is number => Boolean(id));
    const mensajes: Record<number, MensajeKommo[]> = await getMensajesPorLead(leadIds, 7, 6).catch((err) => {
      console.error("Error leyendo mensajes guardados:", err);
      return {};
    });

    return NextResponse.json({
      ok: true,
      resumen,
      conversaciones,
      sinClasificar,
      mensajes,
    });
  } catch (err) {
    console.error("Error obteniendo conversaciones de Kommo:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
