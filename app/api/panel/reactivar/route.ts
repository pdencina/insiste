/**
 * API Panel: Reactivar Lead
 *
 * Genera un mensaje de reconexión personalizado con IA para un lead
 * cuya ventana de 24h expiró. El responsable copia el mensaje y lo
 * envía como template en Kommo/WhatsApp.
 *
 * POST /api/panel/reactivar
 * Body: { contactName, leadName, pipelineName, sede }
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  // Autenticar: admin o sede
  const authHeader = request.headers.get("authorization");
  const sedeAuth = request.headers.get("x-sede-auth");

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !sedeAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { contactName, leadName, pipelineName, sede } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Falta GEMINI_API_KEY" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      systemInstruction: `Eres un asistente que genera mensajes de reconexión para WhatsApp de una institución educacional cristiana llamada AR Ministries.

Los programas son:
- Playgroup: programa preescolar para niños
- AR School: colegio/escuela
- Postulaciones: proceso de admisión

Las sedes son: Puente Alto, Santiago, Punta Arenas.

REGLAS:
1. Máximo 3 líneas. WhatsApp es breve.
2. Tono amigable y cercano, pero profesional.
3. Menciona el nombre del contacto.
4. Haz referencia al programa/servicio por el que consultaron (si se sabe).
5. Ofrece ayuda sin ser invasivo.
6. NO uses emojis excesivos (máximo 1-2).
7. Incluye una pregunta abierta para generar respuesta.
8. El mensaje debe sentirse humano, no robótico.

Responde SOLO con el mensaje, nada más.`,
    });

    const prompt = `Genera un mensaje de reconexión de WhatsApp para:
- Contacto: ${contactName}
- Programa/Pipeline: ${pipelineName || leadName || "consulta general"}
- Sede: ${sede || "no especificada"}

El contexto es que este contacto nos escribió interesado pero la conversación se cerró porque pasaron más de 24 horas sin responderle. Necesitamos retomar el contacto de forma natural.`;

    const result = await model.generateContent(prompt);
    const mensaje = result.response.text().trim();

    return NextResponse.json({
      ok: true,
      mensaje,
      contactName,
    });
  } catch (err) {
    console.error("Error generando mensaje de reactivación:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
