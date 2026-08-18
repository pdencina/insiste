/**
 * Reset endpoint — Reactiva la cuenta y seguimientos pausados.
 * Solo para administración. Protegido por CRON_SECRET.
 *
 * GET /api/auth/reset
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Reactivar cuentas revocadas
  const { data: cuentas, error: cuentaError } = await supabase
    .from("cuentas")
    .update({ estado: "activa" })
    .eq("estado", "revocada")
    .select("id, email");

  // Reactivar seguimientos pausados por token revocado
  const { data: seguimientos, error: segError } = await supabase
    .from("seguimientos")
    .update({ estado: "activo", motivo_pausa: null })
    .eq("estado", "pausado")
    .eq("motivo_pausa", "Token revocado")
    .select("id, asunto");

  return NextResponse.json({
    ok: true,
    cuentas_reactivadas: cuentas ?? [],
    seguimientos_reactivados: seguimientos ?? [],
    errores: { cuentaError, segError },
  });
}
