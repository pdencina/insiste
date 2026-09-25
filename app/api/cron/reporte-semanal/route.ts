/**
 * Cron: Reporte Semanal de Admisión (viernes 16:00 hora Chile)
 *
 * Arma el reporte semanal contando leads por etapa en Kommo
 * (visitas, matrículas) y lo deja como BORRADOR en Gmail para que
 * el responsable lo revise, complete lo que falte y lo reenvíe.
 *
 * Vercel cron corre en UTC. Chile (CLT) es UTC-3 en verano, UTC-4 invierno.
 * Se agenda para las 20:00 UTC = 16:00 CLT (verano) / 17:00 CLT (invierno).
 * El cron valida internamente que sea viernes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { contarLeadsPorPipeline, obtenerCambiosDeEtapa } from "@/lib/kommo/client";

// Destinatarios del reporte
const DESTINATARIOS = ["paburgos@armglobal.org", "pburgos@armglobal.org", "cnavea@armglobal.org"];

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const force = request.nextUrl.searchParams.get("force") === "true";

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Validar que sea viernes (día 5) en hora Chile, salvo force
    const ahoraChile = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
    if (!force && ahoraChile.getDay() !== 5) {
      return NextResponse.json({ ok: true, msg: "No es viernes, no se genera reporte" });
    }

    // Cambios de etapa desde el lunes 00:00 (hora Chile) hasta ahora
    const ahora = Math.floor(Date.now() / 1000);
    const diasDesdeLunes = (ahoraChile.getDay() + 6) % 7;
    const segundosHoy = ahoraChile.getHours() * 3600 + ahoraChile.getMinutes() * 60 + ahoraChile.getSeconds();
    const desde = ahora - diasDesdeLunes * 86400 - segundosHoy;
    const cambios = await obtenerCambiosDeEtapa(desde, ahora);

    // Contar leads por pipeline de Puente Alto
    const [playgroup, arSchool] = await Promise.all([
      contarLeadsPorPipeline("PLAYGROUP PUENTE ALTO", cambios),
      contarLeadsPorPipeline("AR SCHOOL PUENTE ALTO", cambios),
    ]);

    // Calcular rango de fechas de la semana (lunes a viernes)
    const rango = calcularSemana(ahoraChile);

    // Armar cuerpo del reporte
    const visitasTotal = (playgroup?.visitas ?? 0) + (arSchool?.visitas ?? 0);
    const matriculasPlaygroup = playgroup?.matriculas ?? 0;
    const matriculasArSchool = arSchool?.matriculas ?? 0;

    const cuerpo = armarReporte(rango, visitasTotal, matriculasPlaygroup, matriculasArSchool, playgroup, arSchool);

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
    const asunto = `Reporte gestión de admisión — ${rango}`;

    const rawMessage = buildDraftEmail(cuenta.email, DESTINATARIOS, asunto, cuerpo);

    const draft = await withRetry(() =>
      gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw: rawMessage } },
      })
    );

    // Registrar
    await supabase.from("eventos").insert({
      user_id: cuenta.user_id,
      accion: "reporte_semanal_generado",
      detalle: { rango, visitasTotal, matriculasPlaygroup, matriculasArSchool, draftId: draft.data.id },
    });

    return NextResponse.json({
      ok: true,
      msg: "Reporte generado como borrador",
      rango,
      visitasTotal,
      matriculasPlaygroup,
      matriculasArSchool,
      draftId: draft.data.id,
      preview: cuerpo,
    });
  } catch (err) {
    console.error("Error en reporte semanal:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function calcularSemana(ahora: Date): string {
  // Semana lunes a viernes de la semana actual
  const diasDesdeLunes = (ahora.getDay() + 6) % 7;
  const lunes = new Date(ahora);
  lunes.setDate(ahora.getDate() - diasDesdeLunes);
  const viernes = new Date(lunes);
  viernes.setDate(lunes.getDate() + 4);

  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  if (lunes.getMonth() === viernes.getMonth()) {
    return `${lunes.getDate()} al ${viernes.getDate()} de ${meses[viernes.getMonth()]}`;
  }
  return `${lunes.getDate()} de ${meses[lunes.getMonth()]} al ${viernes.getDate()} de ${meses[viernes.getMonth()]}`;
}

function armarReporte(
  rango: string,
  visitas: number,
  matPlaygroup: number,
  matArSchool: number,
  playgroup: Awaited<ReturnType<typeof contarLeadsPorPipeline>>,
  arSchool: Awaited<ReturnType<typeof contarLeadsPorPipeline>>
): string {
  let cuerpo = `Buenas tardes, equipo\n\n`;
  cuerpo += `Junto con saludar, comparto el reporte de gestión de admisión de la semana.\n\n`;
  cuerpo += `REPORTE GESTIÓN ADMISIÓN\n\n`;
  cuerpo += `Fecha informada: ${rango}\n`;
  cuerpo += `Visitas atendidas: ${visitas}\n`;
  cuerpo += `Visitas agendadas próxima semana: ___ (completar)\n`;
  cuerpo += `Cierre de matrículas Playgroup: ${matPlaygroup}\n`;
  cuerpo += `Cierre de matrículas AR School: ${matArSchool}\n\n`;

  // Detalle adicional (opcional, ayuda al responsable)
  cuerpo += `---\n`;
  cuerpo += `CÓMO SE CALCULÓ (referencia interna, borrar antes de enviar):\n`;
  cuerpo += `Visitas y matrículas = leads que entraron a esas etapas esta semana.\n`;
  for (const sede of [playgroup, arSchool]) {
    if (!sede) continue;
    const etapasVisita = sede.visitasEtapas.length > 0 ? sede.visitasEtapas.join(", ") : "ninguna etapa con \"visita\"";
    cuerpo += `  - ${sede.pipelineName}: visitas contadas en [${etapasVisita}]`;
    if (sede.visitasAproximado) cuerpo += ` — no hay etapa de visita realizada, REVISAR la cifra`;
    cuerpo += `\n`;
  }
  cuerpo += `\n`;
  cuerpo += `DETALLE POR ETAPA HOY (referencia interna, editar antes de enviar):\n\n`;

  if (playgroup) {
    cuerpo += `PLAYGROUP (${playgroup.totalLeads} leads en el pipeline):\n`;
    for (const etapa of playgroup.etapas.sort((a, b) => b.cantidad - a.cantidad)) {
      cuerpo += `  - ${etapa.etapaName}: ${etapa.cantidad}\n`;
    }
    cuerpo += `\n`;
  }

  if (arSchool) {
    cuerpo += `AR SCHOOL (${arSchool.totalLeads} leads en el pipeline):\n`;
    for (const etapa of arSchool.etapas.sort((a, b) => b.cantidad - a.cantidad)) {
      cuerpo += `  - ${etapa.etapaName}: ${etapa.cantidad}\n`;
    }
    cuerpo += `\n`;
  }

  cuerpo += `---\n`;
  cuerpo += `Nota: revisa y completa las "visitas agendadas próxima semana" y elimina el detalle por etapa antes de enviar.\n\n`;
  cuerpo += `Saludos cordiales.`;

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
