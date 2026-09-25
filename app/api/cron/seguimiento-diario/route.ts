/**
 * Cron: Seguimiento diario por sede (lunes a viernes, 8:30 hora Chile)
 *
 * Envía al responsable de cada sede activa (hoy solo Puente Alto) un email con:
 * - Chats en "Incoming leads" que nadie del equipo respondió
 * - Leads recién vencidos (pasaron el límite de días de su etapa, hasta 14 días
 *   sin movimiento): nombre + enlace, para recuperarlos hoy
 * - Leads acumulados (más de 14 días sin movimiento): solo conteo por etapa
 *
 * Vercel cron corre en UTC. 11:30 UTC = 8:30 CLT (verano, UTC-3) / 7:30 (invierno, UTC-4).
 * ?preview=true devuelve los textos sin enviar ni registrar nada.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import {
  getLeadsEstancados,
  getSinClasificar,
  RESPONSABLES_SEDE,
  type LeadEstancado,
  type SinClasificarResultado,
} from "@/lib/kommo/client";

const DIAS_RECUPERABLE = 14;
const MAX_LISTADOS = 25;
// Por ahora solo Puente Alto (Playgroup + AR School Puente Alto), que responde Pablo Encina.
// Para sumar otra sede, agregarla aquí.
const SEDES_ACTIVAS = ["Puente Alto"];

// Kommo pagina de a 250 y el reporte/panel hace varias lecturas: dar margen
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preview = request.nextUrl.searchParams.get("preview") === "true";

  try {
    const [estancados, sinClasificar] = await Promise.all([getLeadsEstancados(), getSinClasificar()]);

    const hoy = new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" });
    const correos: { sede: string; email: string; asunto: string; cuerpo: string }[] = [];

    for (const { sede, leads } of estancados) {
      const responsable = RESPONSABLES_SEDE[sede.toLowerCase()];
      if (!responsable || !SEDES_ACTIVAS.includes(sede)) continue;

      // Solo chats de los embudos de la sede (no las entradas generales)
      const deLaSede = sinClasificar.recientes.filter((c) => c.sede === sede);
      const sinAceptar = deLaSede.filter((c) => !c.respondido);
      const respondidosSinAceptar = deLaSede.length - sinAceptar.length;
      const recientes = leads.filter((l) => l.diasSinMovimiento <= DIAS_RECUPERABLE);
      const acumulados = leads.filter((l) => l.diasSinMovimiento > DIAS_RECUPERABLE);
      if (sinAceptar.length === 0 && recientes.length === 0) continue;

      correos.push({
        sede,
        email: responsable.email,
        asunto: `Seguimiento ${sede} (${hoy}): ${sinAceptar.length} sin responder, ${recientes.length} por recuperar`,
        cuerpo: armarCuerpo(responsable.nombre, sede, sinAceptar, respondidosSinAceptar, recientes, acumulados),
      });
    }

    if (preview) {
      return NextResponse.json({ ok: true, preview: true, correos });
    }

    const supabase = createServiceClient();
    const { data: cuenta } = await supabase
      .from("cuentas")
      .select("*")
      .eq("estado", "activa")
      .limit(1)
      .single();

    if (!cuenta) {
      return NextResponse.json({ ok: true, msg: "No hay cuenta activa para enviar emails" });
    }

    const gmail = await getGmailClient(cuenta.id);
    let emailsEnviados = 0;

    for (const correo of correos) {
      // Un solo envío por sede al día
      const { data: yaEnviado } = await supabase
        .from("eventos")
        .select("id")
        .eq("accion", "seguimiento_diario_enviado")
        .eq("detalle->>sede", correo.sede)
        .eq("detalle->>fecha", hoy)
        .limit(1);

      if (yaEnviado && yaEnviado.length > 0) continue;

      try {
        const raw = buildRawEmail(cuenta.email, correo.email, correo.asunto, correo.cuerpo);
        await withRetry(() => gmail.users.messages.send({ userId: "me", requestBody: { raw } }));

        await supabase.from("eventos").insert({
          user_id: cuenta.user_id,
          accion: "seguimiento_diario_enviado",
          detalle: { sede: correo.sede, fecha: hoy, email: correo.email, asunto: correo.asunto },
        });
        emailsEnviados++;
      } catch (err) {
        console.error(`Error enviando seguimiento a ${correo.email}:`, err);
      }
    }

    return NextResponse.json({ ok: true, emailsEnviados, sedes: correos.map((c) => c.asunto) });
  } catch (err) {
    console.error("Error en cron seguimiento-diario:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function armarCuerpo(
  nombre: string,
  sede: string,
  sinAceptar: SinClasificarResultado["recientes"],
  respondidosSinAceptar: number,
  recientes: LeadEstancado[],
  acumulados: LeadEstancado[]
): string {
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  let cuerpo = `Hola ${nombre},\n\n`;
  cuerpo += `Este es el seguimiento de hoy para ${sede}.\n\n`;

  if (sinAceptar.length > 0) {
    cuerpo += `CHATS SIN RESPONDER (${sinAceptar.length})\n`;
    cuerpo += `Están en "Incoming leads" (últimos 7 días) y nadie del equipo respondió su último mensaje:\n`;
    for (const c of sinAceptar.slice(0, MAX_LISTADOS)) {
      const url = c.leadId ? `https://${subdomain}.kommo.com/leads/detail/${c.leadId}` : "";
      cuerpo += `  - ${c.nombre} (${c.pipelineName ?? c.origen}) — sin respuesta hace ${formatearTiempo(c.minutosEsperando)} ${url}\n`;
    }
    if (sinAceptar.length > MAX_LISTADOS) cuerpo += `  ... y ${sinAceptar.length - MAX_LISTADOS} más (ver panel)\n`;
    if (respondidosSinAceptar > 0) cuerpo += `  (+ ${respondidosSinAceptar} ya respondidos pero sin aceptar: acéptalos y muévelos a su etapa)\n`;
    cuerpo += `\n`;
  }

  if (recientes.length > 0) {
    cuerpo += `POR RECUPERAR HOY (${recientes.length})\n`;
    cuerpo += `Pasaron el plazo de su etapa pero llevan ${DIAS_RECUPERABLE} días o menos sin movimiento:\n`;
    for (const l of recientes.slice(0, MAX_LISTADOS)) {
      cuerpo += `  - ${l.nombre} — ${l.pipelineName} / ${l.etapa} — ${l.diasSinMovimiento} días (plazo ${l.limiteDias}) ${l.url}\n`;
    }
    if (recientes.length > MAX_LISTADOS) cuerpo += `  ... y ${recientes.length - MAX_LISTADOS} más\n`;
    cuerpo += `\n`;
  }

  if (acumulados.length > 0) {
    cuerpo += `ACUMULADOS (${acumulados.length} con más de ${DIAS_RECUPERABLE} días sin movimiento)\n`;
    const porEtapa = new Map<string, number>();
    for (const l of acumulados) {
      const key = `${l.pipelineName} / ${l.etapa}`;
      porEtapa.set(key, (porEtapa.get(key) ?? 0) + 1);
    }
    for (const [etapa, n] of [...porEtapa].sort((a, b) => b[1] - a[1])) {
      cuerpo += `  - ${etapa}: ${n}\n`;
    }
    cuerpo += `Conviene moverlos a "No le interesa" o a remarketing para que no ensucien el tablero.\n\n`;
  }

  cuerpo += `---\n`;
  cuerpo += `Ver panel: https://insiste-nine.vercel.app/sede/${sede.toLowerCase().replace(/\s+/g, "-")}\n\n`;
  cuerpo += `-- Insiste (seguimiento automático)`;
  return cuerpo;
}

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
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

/**
 * Formatea minutos a texto legible: "45 min", "2h 30min", "1 día"
 */
function formatearTiempo(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  const dias = Math.floor(minutos / 1440);
  return dias === 1 ? "1 día" : `${dias} días`;
}
