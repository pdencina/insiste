/**
 * API Panel: Sugerir respuesta predefinida
 *
 * Recibe lo que escribió la familia y devuelve las respuestas predefinidas
 * que mejor calzan (máx. 3), elegidas por IA SOLO entre las plantillas del
 * documento oficial. No redacta texto nuevo: el responsable copia, completa
 * los [CORCHETES] y envía desde Kommo.
 *
 * POST /api/panel/sugerir
 * Body: { mensaje, nombre?, contexto? }
 */

import { NextRequest, NextResponse } from "next/server";
import { verificarPanel } from "@/lib/panel/sesion";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PLANTILLAS } from "@/lib/kommo/plantillas";
import { completarNombre, sugerirPorPalabras } from "@/lib/kommo/sugerencias";

const SYSTEM_PROMPT = `Eres parte del equipo de admisión de AR School, sede Puente Alto (Chile).
Tu única tarea es elegir, de un catálogo cerrado de respuestas predefinidas, las que mejor responden al mensaje de una familia.

REGLAS:
1. Solo puedes devolver IDs que existan en el catálogo. Nunca inventes texto.
2. Devuelve entre 1 y 3 IDs, el más adecuado primero.
3. Usa solo plantillas de tipo "mensaje" (nunca las notas internas 11.x).
4. Si mencionan diagnóstico, TEA, TDAH, PIE o necesidades de apoyo → prioriza la sección 6.
5. Si preguntan por valores o precios → 7.1 (Play Group) o 7.2 (AR School) según la edad/nivel; si no se sabe el nivel, agrega 12.1 (preguntar edad).
6. Si se quejan por demora o mala atención → 10.1.
7. Si dicen la edad del niño, elige la plantilla de la sección 3 más cercana a esa edad.
8. Si es solo un saludo o "quiero información" sin más contexto → 1.1 o 1.2 según el canal/pipeline.
9. 7.4 requiere autorización interna: sugiérela solo si hablan explícitamente de distancia o traslado.

Responde SOLO con JSON: {"ids": ["x.y", ...], "motivo": "una frase corta en español"}`;

export async function POST(request: NextRequest) {
  // Sesión de sede firmada (x-sede-token) o admin (Bearer CRON_SECRET)
  if (!verificarPanel(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const mensaje = String(body.mensaje ?? "").trim();
    const { nombre, contexto } = body;
    if (!mensaje) {
      return NextResponse.json({ error: "Falta el mensaje de la familia" }, { status: 400 });
    }

    let ids: string[] = [];
    let motivo = "";
    try {
      const r = await sugerirConIA(mensaje, contexto);
      ids = r.ids;
      motivo = r.motivo;
    } catch (err) {
      // Gemini a veces responde 503 por demanda: no dejar al responsable sin sugerencia
      console.error("IA no disponible, usando palabras clave:", err);
      ids = sugerirPorPalabras(mensaje, contexto);
      motivo = "Sugerencia por palabras clave (la IA no respondió)";
    }

    const sugerencias = ids
      .map((id) => PLANTILLAS.find((p) => p.id === id && p.tipo === "mensaje"))
      .filter((p): p is (typeof PLANTILLAS)[number] => Boolean(p))
      .slice(0, 3)
      .map((p) => ({ ...p, texto: completarNombre(p.texto, nombre) }));

    return NextResponse.json({ ok: true, sugerencias, motivo });
  } catch (err) {
    console.error("Error sugiriendo respuesta:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function sugerirConIA(mensaje: string, contexto?: string): Promise<{ ids: string[]; motivo: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Falta GEMINI_API_KEY");

  const catalogo = PLANTILLAS.filter((p) => p.tipo === "mensaje")
    .map((p) => `${p.id} | ${p.seccion} | ${p.titulo} | ${p.texto.slice(0, 140).replace(/\s+/g, " ")}`)
    .join("\n");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json" },
  });

  const prompt = `CATÁLOGO (id | sección | título | inicio del texto):
${catalogo}

CONTEXTO: ${contexto || "sin contexto"}
MENSAJE DE LA FAMILIA:
"""
${mensaje.slice(0, 2000)}
"""`;

  // Hasta 3 intentos con espera corta (errores 503 transitorios)
  let ultimoError: unknown;
  for (let intento = 0; intento < 3; intento++) {
    try {
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text());
      const ids: string[] = Array.isArray(parsed.ids) ? parsed.ids : [];
      if (ids.length === 0) throw new Error("La IA no devolvió sugerencias");
      return { ids, motivo: parsed.motivo ?? "" };
    } catch (err) {
      ultimoError = err;
      await new Promise((r) => setTimeout(r, 800 * (intento + 1)));
    }
  }
  throw ultimoError;
}
