/**
 * Redacción de recordatorios por escalón de tono.
 *
 * Escalones:
 * 1. Cordial — Reflotar el correo, asumir que se traspapeló
 * 2. Recordatorio — Mencionar días transcurridos, repetir el pedido
 * 3. Directo — Pedir una fecha estimada
 * 4. Cierre — Ofrecer dar el tema por cerrado
 *
 * Prohibiciones explícitas en el system prompt:
 * - No inventar compromisos
 * - No fijar plazos que el usuario no definió
 * - No mencionar montos que no estén en el hilo
 * - No amenazar
 * - Máximo 5 líneas
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ComposerInput {
  asunto: string;
  objetivo: string;
  destinatario: string;
  diasSinRespuesta: number;
  escalon: number; // 1-4
  resumenHilo?: string; // Contexto breve del hilo
}

export interface ComposerResult {
  cuerpo: string;
  escalon: number;
  modelo: string;
}

const SYSTEM_PROMPT = `Eres un asistente que redacta correos de seguimiento breves y profesionales en español.

REGLAS ABSOLUTAS:
1. Máximo 5 líneas. Sin saludos largos ni despedidas elaboradas.
2. NUNCA inventes compromisos que no se hayan mencionado.
3. NUNCA fijes plazos que el usuario no definió.
4. NUNCA menciones montos, precios ni cifras que no estén explícitamente en el contexto.
5. NUNCA amenaces ni uses tono agresivo.
6. Escribe en primera persona singular (yo, mi).
7. No uses emojis.
8. No incluyas asunto ni encabezados, solo el cuerpo del mensaje.
9. Tutea al destinatario (tú, no usted) salvo que el contexto indique formalidad.

ESCALONES DE TONO:
- Escalón 1 (Cordial): Reflotar suavemente. Asumir que el correo se traspapeló. "Te escribo por si se traspapeló..."
- Escalón 2 (Recordatorio): Mencionar cuántos días han pasado y repetir el pedido concreto. "Han pasado X días desde..."
- Escalón 3 (Directo): Pedir una fecha estimada de entrega. "¿Me podrías dar una fecha estimada para...?"
- Escalón 4 (Cierre): Ofrecer dar el tema por cerrado. "Si ya no corresponde, me cuentas y lo doy por cerrado de mi lado."

El escalón 4 es el más efectivo. Dar salida al otro suele destrabar la respuesta.

Responde SOLO con el texto del correo, nada más.`;

/**
 * Redacta un recordatorio usando Claude.
 */
export async function redactarRecordatorio(
  input: ComposerInput
): Promise<ComposerResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const model = "claude-3-5-sonnet-20241022";

  const userPrompt = buildComposerPrompt(input);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const cuerpo =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  return {
    cuerpo,
    escalon: input.escalon,
    modelo: model,
  };
}

/**
 * Genera un acuse de recibo breve.
 * No requiere LLM — es una plantilla simple.
 */
export function generarAcuseRecibo(objetivo: string): string {
  if (objetivo) {
    return `Recibido, gracias. Quedo al tanto.`;
  }
  return `Recibido, gracias.`;
}

function buildComposerPrompt(input: ComposerInput): string {
  const { asunto, objetivo, destinatario, diasSinRespuesta, escalon, resumenHilo } = input;

  let prompt = `CONTEXTO:
- Asunto del hilo: ${asunto}
- Qué estoy esperando: ${objetivo || "una respuesta"}
- Destinatario: ${destinatario}
- Días sin respuesta: ${diasSinRespuesta}
- Escalón de tono: ${escalon} de 4`;

  if (resumenHilo) {
    prompt += `\n- Resumen del hilo: ${resumenHilo}`;
  }

  prompt += `\n\nRedacta el recordatorio en escalón ${escalon}.`;

  return prompt;
}
