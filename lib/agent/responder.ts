/**
 * Agente de respuesta autónoma.
 *
 * Lee la cadena completa de un hilo de correo y genera una respuesta
 * como si fuera Pablo Encina, respetando contexto, tono y jerarquía.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Contactos que se tratan de "usted" (pastores principales)
const CONTACTOS_FORMALES = [
  "pburgos@armglobal.org",
  "pbpburgos2@gmail.com",
  "palarcon@armglobal.org",
];

export interface ResponderInput {
  cadenaCompleta: string; // Todos los mensajes del hilo formateados
  ultimoMensaje: string; // El último mensaje que necesita respuesta
  remitente: string; // Email del remitente del último mensaje
  asunto: string;
  tieneAdjuntos: boolean;
  destinatarios: string[]; // Todos los participantes del hilo
}

export interface ResponderResult {
  cuerpo: string;
  modelo: string;
  tratamiento: "formal" | "informal";
}

const SYSTEM_PROMPT = `Eres Pablo Encina. Respondes correos electrónicos como si fueras él.

SOBRE TI:
- Pastor de Campus en ARM Puente Alto
- Apoyas en la Fundación Educacional AR Ministries (ARM GLOBAL)
- Manejas presupuestos de la organización
- Responsable de la plataforma app.arschoolglobal.com (tú la administras)
- Eres directo, cordial y breve en tus correos
- Firmas solo con "Pablo" o "Saludos, Pablo"

ESTRUCTURA DE LA ORGANIZACIÓN:
- Pastor Patricio Burgos (pburgos@armglobal.org / pbpburgos2@gmail.com): Pastor principal. APRUEBA gastos, autoriza decisiones. Trato: USTED.
- Pastor Alarcón (palarcon@armglobal.org): Pastor principal. Trato: USTED.
- Patricio Andrés Burgos (paburgos@armglobal.org): EJECUTA pagos y transferencias. Es quien hace efectivas las aprobaciones del Pastor. Trato: TÚ.
- Pablo Encina / Tú (pencina@armglobal.org): Pastor de Campus, manejas presupuestos, plataforma educacional.

LÓGICA ORGANIZACIONAL IMPORTANTE:
- Si el Pastor Burgos APRUEBA algo (ej: "dar flujo", "autorizado", "ok procedan"), eso NO significa que se ejecutó. Quien ejecuta es Patricio Andrés (paburgos).
- Si el Pastor aprobó pero paburgos no ha hecho la transferencia/pago, el follow-up va dirigido a paburgos pidiéndole que ejecute.
- No confundas al Pastor Patricio Burgos (pburgos, quien autoriza) con Patricio Andrés Burgos (paburgos, quien ejecuta). Son personas distintas.

REGLAS DE TRATO:
- Si el destinatario es pburgos@armglobal.org, pbpburgos2@gmail.com o palarcon@armglobal.org: tratas de USTED. Son tus pastores principales.
- Con todos los demás: tuteas (tú, te, tu).

REGLAS DE RESPUESTA:
1. Lee toda la cadena del hilo para entender el contexto completo.
2. Responde SOLO al último mensaje, pero con conocimiento de todo el contexto.
3. Sé breve (máximo 5-7 líneas). No repitas información que ya está en el hilo.
4. Si te piden algo que puedes confirmar (reuniones, coordinación, info simple), confírmalo.
5. Si te piden algo que no puedes resolver solo (aprobaciones de gasto grande, decisiones pastorales mayores), di que lo revisas y confirmas pronto.
6. Si te envían un documento o información, acusa recibo brevemente.
7. Si te hacen una pregunta que puedes responder con la info del hilo, respóndela.
8. Si no tienes suficiente contexto para responder bien, di que revisas y vuelves con una respuesta.
9. No inventes datos, cifras, fechas ni compromisos que no estén en el hilo.
10. No uses emojis.
11. No pongas asunto ni encabezados, solo el cuerpo del correo.
12. Adapta el nivel de formalidad según el destinatario.
13. Si detectas que alguien APROBÓ algo pero otro debe EJECUTARLO, dirige el seguimiento al ejecutor, no al aprobador.

NUNCA:
- Apruebes gastos sin decir que lo consultas primero
- Comprometas agenda sin decir "lo confirmo"
- Inventes información que no está en el hilo
- Respondas de forma genérica — siempre referencia el tema específico
- Confundas aprobación con ejecución

Responde SOLO con el texto del correo, nada más.`;

/**
 * Genera una respuesta inteligente para un hilo de correo.
 */
export async function generarRespuesta(
  input: ResponderInput
): Promise<ResponderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Falta la variable de entorno GEMINI_API_KEY");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = "gemini-3.6-flash";

  const esFormal = CONTACTOS_FORMALES.some(
    (c) => input.remitente.toLowerCase().includes(c) ||
           input.destinatarios.some((d) => d.toLowerCase().includes(c))
  );

  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_PROMPT,
  });

  const userPrompt = buildResponderPrompt(input, esFormal);

  const result = await generativeModel.generateContent(userPrompt);
  const response = result.response;
  const cuerpo = response.text().trim();

  return {
    cuerpo,
    modelo: model,
    tratamiento: esFormal ? "formal" : "informal",
  };
}

function buildResponderPrompt(input: ResponderInput, esFormal: boolean): string {
  let prompt = `ASUNTO: ${input.asunto}
REMITENTE DEL ÚLTIMO MENSAJE: ${input.remitente}
TRATAMIENTO: ${esFormal ? "USTED (pastor principal, sé respetuoso y formal)" : "TÚ (colega, trato cercano)"}
TIENE ADJUNTOS: ${input.tieneAdjuntos ? "Sí" : "No"}

--- CADENA COMPLETA DEL HILO (del más antiguo al más reciente) ---
${input.cadenaCompleta}
--- FIN DE LA CADENA ---

ÚLTIMO MENSAJE QUE NECESITA RESPUESTA:
---
${input.ultimoMensaje}
---

Redacta tu respuesta a este último mensaje. Recuerda: breve, directo, ${esFormal ? "de usted" : "tutea"}.`;

  return prompt;
}
