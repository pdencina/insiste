/**
 * Agente de respuesta autónoma.
 *
 * Lee la cadena completa de un hilo de correo y genera una respuesta
 * como si fuera el usuario, respetando contexto, tono y jerarquía.
 *
 * La configuración (contactos, perfil, reglas de trato) se carga
 * dinámicamente desde la DB para poder editarse desde el panel web.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createServiceClient } from "@/lib/supabase/client";

// Contactos formales por defecto (se sobreescriben con config de DB)
const DEFAULT_CONTACTOS_FORMALES = [
  "pburgos@armglobal.org",
  "pbpburgos2@gmail.com",
  "palarcon@armglobal.org",
];

interface ContactoConfig {
  email: string;
  nombre: string;
  tratamiento: "formal" | "informal";
  rol: string;
  apodo: string;
}

interface AgentConfig {
  contactos: ContactoConfig[];
  perfil: { nombre: string; roles: string[]; firma: string };
}

/**
 * Carga la configuración del agente desde la DB.
 */
async function loadConfig(): Promise<AgentConfig | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("eventos")
      .select("detalle")
      .eq("accion", "agent_config")
      .order("creado_en", { ascending: false })
      .limit(1)
      .single();

    return data?.detalle ?? null;
  } catch {
    return null;
  }
}

export interface ResponderInput {
  cadenaCompleta: string;
  ultimoMensaje: string;
  remitente: string;
  asunto: string;
  tieneAdjuntos: boolean;
  destinatarios: string[];
}

export interface ResponderResult {
  cuerpo: string;
  modelo: string;
  tratamiento: "formal" | "informal";
}

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

  // Cargar config dinámica
  const config = await loadConfig();
  const contactosFormales = config?.contactos
    ?.filter((c) => c.tratamiento === "formal")
    .map((c) => c.email) ?? DEFAULT_CONTACTOS_FORMALES;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = "gemini-3.6-flash";

  const esFormal = contactosFormales.some(
    (c) => input.remitente.toLowerCase().includes(c) ||
           input.destinatarios.some((d) => d.toLowerCase().includes(c))
  );

  // Construir system prompt dinámico con la config
  const systemPrompt = buildSystemPrompt(config);

  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
  });

  const userPrompt = buildResponderPrompt(input, esFormal, config);

  const result = await generativeModel.generateContent(userPrompt);
  const response = result.response;
  const cuerpo = response.text().trim();

  return {
    cuerpo,
    modelo: model,
    tratamiento: esFormal ? "formal" : "informal",
  };
}

function buildResponderPrompt(input: ResponderInput, esFormal: boolean, config: AgentConfig | null): string {
  const contacto = config?.contactos?.find(
    (c) => input.remitente.toLowerCase() === c.email.toLowerCase() ||
           input.destinatarios.some((d) => d.toLowerCase() === c.email.toLowerCase())
  );

  const tratamientoDesc = esFormal
    ? `USTED (${contacto?.apodo ?? "trato formal"})`
    : `TÚ (${contacto?.apodo ?? "colega, trato cercano"})`;

  return `ASUNTO: ${input.asunto}
REMITENTE DEL ÚLTIMO MENSAJE: ${input.remitente}
TRATAMIENTO: ${tratamientoDesc}
TIENE ADJUNTOS: ${input.tieneAdjuntos ? "Sí" : "No"}

--- CADENA COMPLETA DEL HILO (del más antiguo al más reciente) ---
${input.cadenaCompleta}
--- FIN DE LA CADENA ---

ÚLTIMO MENSAJE QUE NECESITA RESPUESTA:
---
${input.ultimoMensaje}
---

Redacta tu respuesta a este último mensaje. Recuerda: breve, directo, ${esFormal ? "de usted" : "tutea"}.`;
}

/**
 * Construye el system prompt dinámicamente desde la config guardada.
 */
function buildSystemPrompt(config: AgentConfig | null): string {
  const contactos = config?.contactos ?? [];
  const perfil = config?.perfil ?? { nombre: "Pablo Encina", roles: [], firma: "Saludos, Pablo" };

  const contactosSection = contactos.length > 0
    ? contactos.map((c) => `- ${c.nombre} (${c.email}): ${c.rol}. Trato: ${c.tratamiento === "formal" ? "USTED" : "TÚ"}. Lo/la llamas: "${c.apodo}".`).join("\n")
    : `- Pastor Patricio Burgos (pburgos@armglobal.org / pbpburgos2@gmail.com): Aprueba gastos. Trato: USTED. Lo llamas: "Mi Pastor".
- Pastora Alarcón (palarcon@armglobal.org): Pastora principal. Trato: USTED. La llamas: "Mi Pastora".
- Patricio Andrés Burgos (paburgos@armglobal.org): Ejecuta pagos. Trato: TÚ. Lo llamas: "Pato Andrés".`;

  const rolesSection = perfil.roles.length > 0
    ? perfil.roles.map((r) => `- ${r}`).join("\n")
    : `- Pastor de Campus en ARM Puente Alto
- Apoyas en la Fundación Educacional AR Ministries (ARM GLOBAL)
- Manejas presupuestos de la organización
- Responsable de la plataforma app.arschoolglobal.com`;

  return `Eres ${perfil.nombre}. Respondes correos electrónicos como si fueras él.

SOBRE TI:
${rolesSection}
- Eres directo, cordial y breve en tus correos
- Firmas con "${perfil.firma}"

ESTRUCTURA DE LA ORGANIZACIÓN:
${contactosSection}

LÓGICA ORGANIZACIONAL IMPORTANTE:
- Si alguien APRUEBA algo (ej: "dar flujo", "autorizado", "ok procedan"), eso NO significa que se ejecutó. Quien ejecuta es la persona con rol de ejecución.
- Si se aprobó pero no se ejecutó, el follow-up va dirigido al ejecutor, no al aprobador.
- No confundas personas que comparten apellido. Usa el email para distinguirlas.

REGLAS DE TRATO:
- A los contactos marcados como "formal": tratas de USTED y los llamas por su apodo configurado.
- A los contactos marcados como "informal": tuteas y los llamas por su apodo.
- A desconocidos: tuteas por defecto, trato cordial.

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
13. Si detectas que alguien APROBÓ algo pero otro debe EJECUTARLO, dirige el seguimiento al ejecutor.

NUNCA:
- Apruebes gastos sin decir que lo consultas primero
- Comprometas agenda sin decir "lo confirmo"
- Inventes información que no está en el hilo
- Respondas de forma genérica — siempre referencia el tema específico
- Confundas aprobación con ejecución

Responde SOLO con el texto del correo, nada más.`;
}
