/**
 * Webhook de Kommo: mensajes de chat entrantes y salientes.
 *
 * Configurar en Kommo → Configuración → Integraciones → Webhooks, con la URL
 * https://insiste-nine.vercel.app/api/kommo/webhook?token=<token> y los eventos
 * "Mensaje entrante recibido" y "Mensaje saliente enviado".
 * El token se deriva de CRON_SECRET (ver lib/kommo/mensajes.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { extraerMensajes, guardarMensajes, parsearFormulario, tokenValido } from "@/lib/kommo/mensajes";

export async function POST(request: NextRequest) {
  if (!tokenValido(request.nextUrl.searchParams.get("token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cuerpo = await request.text();
    const tipo = request.headers.get("content-type") ?? "";
    const payload = tipo.includes("application/json") ? JSON.parse(cuerpo) : parsearFormulario(cuerpo);
    const guardados = await guardarMensajes(extraerMensajes(payload));
    return NextResponse.json({ ok: true, guardados });
  } catch (err) {
    // Responder 200 igual: si Kommo recibe errores seguidos, desactiva el webhook
    console.error("Error procesando webhook de Kommo:", err);
    return NextResponse.json({ ok: false });
  }
}
