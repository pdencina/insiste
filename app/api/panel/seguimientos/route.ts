/**
 * API Panel: Seguimientos
 *
 * Lista los seguimientos activos con su estado y próximo intento.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const { data: seguimientos, error } = await supabase
      .from("seguimientos")
      .select("*")
      .in("estado", ["activo", "pausado"])
      .order("proximo_intento", { ascending: true });

    if (error) {
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, seguimientos: seguimientos ?? [] });
  } catch (err) {
    console.error("Error en panel seguimientos:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
