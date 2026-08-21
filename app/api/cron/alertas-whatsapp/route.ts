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
      // Solo alertar si hay críticos o alertas (no expirados solamente)
      const urgentes = sede.criticos + sede.alertas;
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
      const asunto = `⚠️ Alerta WhatsApp ${sede.sede}: ${sede.criticos} críticos, ${sede.alertas} en alerta`;

      let cuerpo = `Hola ${sede.responsable},\n\n`;
      cuerpo += `Tienes conversaciones de WhatsApp que están por expirar en la sede ${sede.sede}:\n\n`;

      if (sede.criticos > 0) {
        cuerpo += `🔴 CRÍTICOS (menos de 2 horas):\n`;
        for (const conv of sede.conversaciones.filter((c) => c.estado === "critico")) {
          cuerpo += `  • ${conv.contactName} — ${conv.minutosRestantes} min restantes\n`;
        }
        cuerpo += `\n`;
      }

      if (sede.alertas > 0) {
        cuerpo += `🟡 EN ALERTA (menos de 6 horas):\n`;
        for (const conv of sede.conversaciones.filter((c) => c.estado === "alerta")) {
          cuerpo += `  • ${conv.contactName} — ${conv.horasRestantes}h restantes\n`;
        }
        cuerpo += `\n`;
      }

      cuerpo += `Responde estos chats antes de que se cierre la ventana de 24h.\n`;
      cuerpo += `Si se vencen, necesitarás un template para reconectar.\n\n`;
      cuerpo += `— Insiste (alerta automática)`;

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
            criticos: sede.criticos,
            alertas: sede.alertas,
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
        criticos: s.criticos,
        alertas: s.alertas,
        expirados: s.expirados,
      })),
    });
  } catch (err) {
    console.error("Error en cron alertas-whatsapp:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function buildRawEmail(from: string, to: string, subject: string, body: string): string {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    "",
    body,
  ];

  return Buffer.from(lines.join("\r\n"), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
