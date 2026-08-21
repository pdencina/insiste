/**
 * Cron: Alertas WhatsApp (cada hora)
 *
 * Revisa conversaciones en Kommo, agrupa por sede y envía email
 * al responsable si hay conversaciones críticas (<2h) o en alerta (<6h).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { getConversacionesAbiertas, agruparPorSede } from "@/lib/kommo/client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const conversaciones = await getConversacionesAbiertas();
    const porSede = agruparPorSede(conversaciones);

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

    for (const sede of porSede) {
      // Solo alertar si hay demorados o pendientes (leads que se están enfriando)
      const urgentes = sede.demorados + sede.pendientes;
      if (urgentes === 0 || !sede.email) continue;

      // Verificar que no hayamos enviado alerta en la última hora
      const { data: alertaReciente } = await supabase
        .from("eventos")
        .select("id")
        .eq("accion", "alerta_whatsapp_enviada")
        .eq("detalle->>sede", sede.sede)
        .gte("creado_en", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .limit(1);

      if (alertaReciente && alertaReciente.length > 0) continue;

      // Construir email
      const asunto = `Alerta WhatsApp ${sede.sede}: ${sede.demorados} demorados, ${sede.pendientes} pendientes`;

      let cuerpo = `Hola ${sede.responsable},\n\n`;
      cuerpo += `Tienes leads sin responder en ${sede.sede}:\n\n`;

      if (sede.demorados > 0) {
        cuerpo += `DEMORADOS (mas de 30 min sin respuesta):\n`;
        for (const conv of sede.conversaciones.filter((c) => c.estado === "demorado")) {
          cuerpo += `  - ${conv.contactName} — ${formatearTiempo(conv.minutosSinResponder)} sin responder\n`;
        }
        cuerpo += `\n`;
      }

      if (sede.pendientes > 0) {
        cuerpo += `PENDIENTES (5-30 min sin respuesta):\n`;
        for (const conv of sede.conversaciones.filter((c) => c.estado === "pendiente")) {
          cuerpo += `  - ${conv.contactName} — ${formatearTiempo(conv.minutosSinResponder)} sin responder\n`;
        }
        cuerpo += `\n`;
      }

      cuerpo += `---\n`;
      cuerpo += `Cada minuto que pasa, el lead se enfria. Responde ahora.\n\n`;
      cuerpo += `Ver panel: https://insiste-nine.vercel.app/sede/${sede.sede.toLowerCase().replace(/\s+/g, "-")}\n\n`;
      cuerpo += `-- Insiste (alerta automatica)`;

      // Enviar email via Gmail
      try {
        const rawMessage = buildRawEmail(cuenta.email, sede.email, asunto, cuerpo);

        await withRetry(() =>
          gmail.users.messages.send({
            userId: "me",
            requestBody: { raw: rawMessage },
          })
        );

        // Registrar que se envió la alerta
        await supabase.from("eventos").insert({
          user_id: cuenta.user_id,
          accion: "alerta_whatsapp_enviada",
          detalle: {
            sede: sede.sede,
            responsable: sede.responsable,
            email: sede.email,
            demorados: sede.demorados,
            pendientes: sede.pendientes,
          },
        });

        emailsEnviados++;
      } catch (err) {
        console.error(`Error enviando alerta a ${sede.email}:`, err);
      }
    }

    return NextResponse.json({
      ok: true,
      emailsEnviados,
      sedes: porSede.map((s) => ({
        sede: s.sede,
        responsable: s.responsable,
        demorados: s.demorados,
        pendientes: s.pendientes,
        frios: s.frios,
        expirados: s.expirados,
      })),
    });
  } catch (err) {
    console.error("Error en cron alertas-whatsapp:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  // Codificar subject como UTF-8 base64 para soportar emojis y acentos
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
