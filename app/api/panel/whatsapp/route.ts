/**
 * API Panel: WhatsApp Alerts
 *
 * Devuelve las conversaciones abiertas en Kommo con su countdown
 * de la ventana de 24h de WhatsApp, más los chats que llegaron a
 * "Incoming leads" y nadie aceptó todavía.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConversacionesAbiertas, calcularResumen, getSinClasificar } from "@/lib/kommo/client";

// Kommo pagina de a 250 y el reporte/panel hace varias lecturas: dar margen
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const sedeAuth = request.headers.get("x-sede-auth");

  // Autenticar: admin con Bearer token, o sede con x-sede-auth header
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !sedeAuth) {
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

    return NextResponse.json({
      ok: true,
      resumen,
      conversaciones,
      sinClasificar,
    });
  } catch (err) {
    console.error("Error obteniendo conversaciones de Kommo:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
