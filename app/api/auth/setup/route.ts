/**
 * Setup endpoint — Crea las etiquetas necesarias en Gmail para la cuenta conectada.
 * Llama una sola vez después de autorizar.
 *
 * GET /api/auth/setup
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { ensureLabelId, LABEL_NAMES } from "@/lib/gmail/labels";

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Obtener la primera cuenta activa
    const { data: cuenta, error: cuentaError } = await supabase
      .from("cuentas")
      .select("*")
      .eq("estado", "activa")
      .limit(1)
      .single();

    if (cuentaError || !cuenta) {
      return NextResponse.json(
        { error: "No hay cuenta activa. Conectá tu Gmail primero en /api/auth/login" },
        { status: 400 }
      );
    }

    // Obtener cliente Gmail
    const gmail = await getGmailClient(cuenta.id);

    // Crear las 3 etiquetas
    const labels: Record<string, string> = {};
    for (const [key, name] of Object.entries(LABEL_NAMES)) {
      const id = await ensureLabelId(gmail, name as typeof LABEL_NAMES[keyof typeof LABEL_NAMES]);
      labels[key] = `${name} (${id})`;
    }

    // Activar envio_habilitado ahora que todo está configurado
    await supabase
      .from("cuentas")
      .update({ envio_habilitado: true })
      .eq("id", cuenta.id);

    return NextResponse.json({
      ok: true,
      email: cuenta.email,
      labels,
      envio_habilitado: true,
      message: "Etiquetas creadas y envío habilitado. El agente está listo.",
    });
  } catch (err) {
    console.error("Error en setup:", err);
    return NextResponse.json(
      { error: "Error durante setup", details: String(err) },
      { status: 500 }
    );
  }
}
