/**
 * Respaldo con Claude para redactar respuestas cuando Gemini no responde (503 frecuentes).
 * Salida estructurada con zod: la API garantiza el formato JSON pedido.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const Borrador = z.object({
  respuesta: z.string(),
  basadaEn: z.array(z.string()),
  escalar: z.boolean(),
  motivo: z.string(),
});

export type BorradorClaude = z.infer<typeof Borrador>;

export async function redactarConClaude(system: string, prompt: string): Promise<BorradorClaude> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: "claude-opus-5",
    max_tokens: 4000,
    // Tarea corta y sensible a latencia (el panel espera la respuesta): esfuerzo bajo
    output_config: { effort: "low", format: zodOutputFormat(Borrador) },
    // Si el modelo declina por política, la API reintenta con otro modelo en la misma llamada
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declinó redactar esta respuesta");
  if (!response.parsed_output) throw new Error("Claude no devolvió un borrador válido");
  return response.parsed_output;
}
