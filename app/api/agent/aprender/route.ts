/**
 * Endpoint: Aprender estilo de escritura
 *
 * Lee los últimos 50 correos enviados del usuario y genera un perfil
 * de escritura usando Gemini. El perfil se guarda en la DB y se usa
 * para que el agente responda con el mismo estilo.
 *
 * GET /api/agent/aprender
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";
import { getGmailClient } from "@/lib/gmail/client";
import { withRetry } from "@/lib/gmail/client";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
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

    // Leer últimos 50 correos ENVIADOS
    const response = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        labelIds: ["SENT"],
        maxResults: 50,
      })
    );

    const messages = response.data.messages ?? [];
    const correos: string[] = [];

    for (const msg of messages) {
      try {
        const detail = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "full",
          })
        );

        const headers = detail.data.payload?.headers ?? [];
        const to = headers.find((h) => h.name === "To")?.value ?? "";
        const subject = headers.find((h) => h.name === "Subject")?.value ?? "";

        // Extraer cuerpo text/plain
        let body = "";
        const parts = detail.data.payload?.parts ?? [];
        const textPart = parts.find((p) => p.mimeType === "text/plain") ?? detail.data.payload;
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        }

        // Limpiar: quitar texto citado (líneas que empiezan con >)
        const bodyLimpio = body
          .split("\n")
          .filter((line) => !line.startsWith(">") && !line.startsWith("On ") && !line.startsWith("El "))
          .join("\n")
          .trim();

        if (bodyLimpio.length > 10 && bodyLimpio.length < 2000) {
          correos.push(`[Para: ${to}] [Asunto: ${subject}]\n${bodyLimpio}`);
        }
      } catch {
        // Ignorar mensajes que no se pueden leer
      }
    }

    if (correos.length < 5) {
      return NextResponse.json({
        error: "No hay suficientes correos enviados para aprender (mínimo 5)",
        encontrados: correos.length,
      }, { status: 400 });
    }

    // Enviar a Gemini para generar perfil de escritura
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Falta GEMINI_API_KEY" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `Analiza los siguientes ${correos.length} correos electrónicos enviados por una persona y genera un PERFIL DE ESCRITURA detallado.

El perfil debe incluir:
1. ESTILO GENERAL: ¿Es formal, informal, mixto? ¿Breve o extenso?
2. SALUDOS: ¿Cómo saluda? (Hola, Estimado, sin saludo, etc.) Lista los más comunes.
3. DESPEDIDAS/FIRMA: ¿Cómo cierra? (Saludos, Un abrazo, solo el nombre, etc.)
4. LARGO PROMEDIO: ¿Cuántas líneas suele escribir?
5. MULETILLAS Y EXPRESIONES: Frases que repite frecuentemente.
6. TONO: ¿Cercano, profesional, amigable, serio?
7. PATRONES POR CONTEXTO: ¿Cambia el tono según el destinatario o tema?
8. USO DE PUNTUACIÓN: ¿Usa emojis? ¿Signos de exclamación? ¿Puntos suspensivos?
9. VERBOS Y TIEMPOS: ¿Presente, futuro? ¿Imperativo o sugerente?
10. EJEMPLOS DE RESPUESTAS TÍPICAS: 3-5 ejemplos reales representativos (cortos).

CORREOS ENVIADOS:
---
${correos.slice(0, 30).join("\n\n---\n\n")}
---

Genera el perfil en formato texto plano, claro y conciso. Este perfil se usará como instrucción para que una IA responda correos imitando exactamente el estilo de esta persona.`;

    const result = await model.generateContent(prompt);
    const perfilTexto = result.response.text().trim();

    // Guardar perfil en la DB
    await supabase.from("eventos").insert({
      user_id: cuenta.user_id,
      accion: "perfil_escritura",
      detalle: {
        perfil: perfilTexto,
        correos_analizados: correos.length,
        fecha: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      ok: true,
      correos_analizados: correos.length,
      perfil: perfilTexto,
      message: "Perfil de escritura generado y guardado. El agente ahora responderá con tu estilo.",
    });
  } catch (err) {
    console.error("Error en aprender:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
