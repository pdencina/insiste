/**
 * Clasificador de respuestas entrantes usando Claude.
 *
 * Recibe el objetivo del seguimiento y el texto del último mensaje.
 * Devuelve una clasificación JSON estricta validada con Zod.
 *
 * Si confianza < 0.75, no se toma acción automática.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ClaseRespuesta } from "@/lib/supabase/types";

// Schema de respuesta del clasificador
export const ClasificacionSchema = z.object({
  clase: z.enum([
    "entregado",
    "promesa",
    "pregunta",
    "rechazo",
    "irrelevante",
  ]),
  fecha_prometida: z.string().nullable(),
  confianza: z.number().min(0).max(1),
  razon: z.string().max(200),
});

export type ClasificacionLLM = z.infer<typeof ClasificacionSchema>;

export interface ClassifierInput {
  objetivo: string;
  textoMensaje: string;
  remitente: string;
  tieneAdjuntos: boolean;
  asuntoHilo: string;
}

export interface ClassifierResult {
  clase: ClaseRespuesta;
  confianza: number;
  razon: string;
  fecha_prometida: string | null;
  modelo: string;
}

const SYSTEM_PROMPT = `Eres un clasificador de respuestas de correo electrónico. Tu trabajo es determinar si un mensaje recibido constituye la respuesta que el remitente original estaba esperando.

Clasificaciones posibles:
- "entregado": El mensaje contiene exactamente lo que se pedía (documento, presupuesto, confirmación, archivo, etc.)
- "promesa": La persona dice que lo hará o lo enviará, pero aún no lo ha hecho. Puede incluir una fecha.
- "pregunta": La contraparte hace una pregunta que requiere respuesta antes de poder entregar lo solicitado.
- "rechazo": La persona declina, rechaza o dice que no puede/quiere cumplir con lo solicitado.
- "irrelevante": El mensaje no tiene relación con lo que se esperaba (puede ser de otro tema en el mismo hilo).

Reglas:
- Si hay un adjunto y el objetivo menciona un documento/archivo/presupuesto, probablemente es "entregado".
- "Lo veo mañana" o "te lo mando esta semana" es "promesa", no "entregado".
- Si la persona pide más información o aclara algo, es "pregunta".
- Un simple "ok" o "recibido" sin entregar lo pedido es "irrelevante" salvo que lo pedido fuera una confirmación.
- Sé conservador con la confianza. Si no estás seguro, baja el valor.

Responde ÚNICAMENTE con JSON válido, sin texto adicional.`;

/**
 * Clasifica un mensaje entrante usando Claude.
 */
export async function clasificarMensaje(
  input: ClassifierInput
): Promise<ClassifierResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const userPrompt = buildUserPrompt(input);
  const model = "claude-sonnet-4-20250514";

  const response = await anthropic.messages.create({
    model,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Extraer texto de la respuesta
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parsear y validar con Zod
  let parsed: ClasificacionLLM;
  try {
    const json = JSON.parse(text);
    parsed = ClasificacionSchema.parse(json);
  } catch (err) {
    // Si el modelo no devuelve JSON válido, retornar baja confianza
    return {
      clase: "irrelevante",
      confianza: 0.3,
      razon: `Error parseando respuesta del modelo: ${err}`,
      fecha_prometida: null,
      modelo: model,
    };
  }

  return {
    clase: parsed.clase,
    confianza: parsed.confianza,
    razon: parsed.razon,
    fecha_prometida: parsed.fecha_prometida,
    modelo: model,
  };
}

function buildUserPrompt(input: ClassifierInput): string {
  return `OBJETIVO DEL SEGUIMIENTO: ${input.objetivo || "Obtener una respuesta"}

ASUNTO DEL HILO: ${input.asuntoHilo}
REMITENTE DEL MENSAJE: ${input.remitente}
TIENE ADJUNTOS: ${input.tieneAdjuntos ? "Sí" : "No"}

TEXTO DEL MENSAJE:
---
${input.textoMensaje}
---

Clasifica este mensaje. Responde con JSON:
{"clase": "...", "fecha_prometida": "YYYY-MM-DD" o null, "confianza": 0.0-1.0, "razon": "una línea explicando"}`;
}
