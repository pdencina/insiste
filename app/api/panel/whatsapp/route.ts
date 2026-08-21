/**
 * API Panel: WhatsApp Alerts
 *
 * Devuelve las conversaciones abiertas en Kommo con su countdown
 * de la ventana de 24h de WhatsApp.
 */

import { NextRequest, NextResponse } from "next/server";
import { getConversacionesAbiertas, calcularResumen } from "@/lib/kommo/client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const sedeAuth = request.headers.get("x-sede-auth");

  // Autenticar: admin con Bearer token, o sede con x-sede-auth header
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !sedeAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const conversaciones = await getConversacionesAbiertas();
    const resumen = calcularResumen(conversaciones);

    return NextResponse.json({
      ok: true,
      resumen,
      conversaciones,
    });
  } catch (err) {
    console.error("Error obteniendo conversaciones de Kommo:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
