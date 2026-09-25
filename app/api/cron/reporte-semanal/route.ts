/**
 * Cron: Reporte Semanal de Admisión (viernes, hora Chile)
 *
 * Arma el reporte de gestión de admisión de Playgroup y AR School Puente Alto
 * (ver lib/kommo/reporte.ts) y lo deja como BORRADOR en Gmail para que el
 * responsable lo revise, complete lo que falte y lo reenvíe.
 *
 * Vercel cron corre en UTC: 20:00 UTC = 17:00 CLT (verano, UTC-3) / 16:00 (invierno, UTC-4).
 * El cron valida internamente que sea viernes (salvo ?force=true).
 * Opcional: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD para otro período (por defecto, lunes a viernes).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { calcularReporte, notasDeCalculo, semanaActual, textoReporte, type DatosReporte } from "@/lib/kommo/reporte";

// Destinatarios del reporte
const DESTINATARIOS = ["paburgos@armglobal.org", "pburgos@armglobal.org", "cnavea@armglobal.org"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Kommo pagina de a 250 y el reporte/panel hace varias lecturas: dar margen
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const params = request.nextUrl.searchParams;
  const force = params.get("force") === "true";

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Validar que sea viernes (día 5) en hora Chile, salvo force
    const ahoraChile = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
    if (!force && ahoraChile.getDay() !== 5) {
      return NextResponse.json({ ok: true, msg: "No es viernes, no se genera reporte" });
    }

    const semana = semanaActual();
    const desde = FECHA.test(params.get("desde") ?? "") ? params.get("desde")! : semana.desde;
    const hasta = FECHA.test(params.get("hasta") ?? "") ? params.get("hasta")! : semana.hasta;

    const datos = await calcularReporte(desde, hasta);
    const cuerpo = armarCorreo(datos);

    // Crear borrador en Gmail
    const supabase = createServiceClient();
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
    const asunto = `Reporte gestión de admisión — ${datos.rango}`;

    const rawMessage = buildDraftEmail(cuenta.email, DESTINATARIOS, asunto, cuerpo);

    const draft = await withRetry(() =>
      gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: rawMessage } },
      })
    );

    // Registrar
    // Sin el detalle por etapa (pesado): undefined no se guarda en el JSON
    const resumen = { ...datos, playgroup: undefined, arSchool: undefined };
    await supabase.from("eventos").insert({
      user_id: cuenta.user_id,
      accion: "reporte_semanal_generado",
      detalle: { ...resumen, draftId: draft.data.id },
    });

    return NextResponse.json({
      ok: true,
      msg: "Reporte generado como borrador",
      rango: datos.rango,
      draftId: draft.data.id,
      preview: cuerpo,
    });
  } catch (err) {
    console.error("Error en reporte semanal:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function armarCorreo(datos: DatosReporte): string {
  let cuerpo = `Buenas tardes, equipo\n\n`;
  cuerpo += `Junto con saludar, comparto el reporte de gestión de admisión de la semana.\n\n`;
  cuerpo += textoReporte(datos);
  cuerpo += `\nSaludos cordiales.\n\n`;

  // Referencia interna para el responsable: se borra antes de enviar
  cuerpo += `---\n`;
  cuerpo += `REFERENCIA INTERNA (borrar antes de enviar):\n`;
  cuerpo += `${notasDeCalculo(datos)}\n\n`;
  for (const sede of [datos.playgroup, datos.arSchool]) {
    if (!sede) continue;
    cuerpo += `${sede.pipelineName} hoy (${sede.totalLeads} leads):\n`;
    for (const etapa of [...sede.etapas].sort((a, b) => b.cantidad - a.cantidad)) {
      cuerpo += `  - ${etapa.etapaName}: ${etapa.cantidad}\n`;
    }
    cuerpo += `\n`;
  }
  return cuerpo;
}

function buildDraftEmail(from: string, to: string[], subject: string, body: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;

  const lines = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    `MIME-Version: 1.0`,
    "",
    Buffer.from(body, "utf-8").toString("base64"),
  ];

  return Buffer.from(lines.join("\r\n"), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
