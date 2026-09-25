/**
 * API Panel: Reporte de gestión de admisión (Playgroup + AR School Puente Alto)
 *
 * Devuelve el texto del reporte para un período, listo para copiar.
 * No crea borradores ni envía nada (eso lo hace el cron del viernes).
 *
 * GET /api/panel/reporte?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 */

import { NextRequest, NextResponse } from "next/server";
import { calcularReporte, notasDeCalculo, semanaActual, textoReporte } from "@/lib/kommo/reporte";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Kommo pagina de a 250 y el reporte/panel hace varias lecturas: dar margen
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const sedeAuth = request.headers.get("x-sede-auth");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !sedeAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const semana = semanaActual();
  const desde = FECHA.test(params.get("desde") ?? "") ? params.get("desde")! : semana.desde;
  const hasta = FECHA.test(params.get("hasta") ?? "") ? params.get("hasta")! : semana.hasta;
  if (desde > hasta) {
    return NextResponse.json({ error: "La fecha 'desde' es posterior a 'hasta'" }, { status: 400 });
  }

  try {
    const datos = await calcularReporte(desde, hasta);
    return NextResponse.json({
      ok: true,
      desde,
      hasta,
      texto: textoReporte(datos),
      notas: notasDeCalculo(datos),
    });
  } catch (err) {
    console.error("Error generando reporte:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
