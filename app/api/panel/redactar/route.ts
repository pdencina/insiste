/**
 * API Panel: redactar respuesta para una familia (Pablo la revisa y aprueba).
 *
 * Usa: los últimos mensajes del chat (webhook), las respuestas predefinidas del
 * documento oficial, los datos de referencia y dos horarios libres del calendario
 * para proponer visita. No envía nada: devuelve un borrador.
 *
 * POST /api/panel/redactar  Body: { leadId?, mensaje?, nombre?, programa? }
 *   - leadId: toma la conversación guardada por el webhook
 *   - mensaje: texto pegado a mano (si aún no hay conversación guardada)
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { verificarPanel } from "@/lib/panel/sesion";
import { DATOS_REFERENCIA, PLANTILLAS } from "@/lib/kommo/plantillas";
import { getMensajesPorLead, type MensajeKommo } from "@/lib/kommo/mensajes";
import { getDisponibilidad } from "@/lib/google/calendario";
import { completarNombre, sugerirPorPalabras } from "@/lib/kommo/sugerencias";
import { redactarConClaude } from "@/lib/ia/borrador-claude";

export const maxDuration = 60;

const SYSTEM_PROMPT = `Eres Pablo Encina, coordinador de AR School Global, sede Puente Alto (Fundación Educacional ARM Global, Chile). Respondes por WhatsApp a familias interesadas en Play Group o AR School.

OBJETIVO: no cerrar la matrícula por chat, sino responder la consulta concreta y llevar a una VISITA a la sede. En orden: 1) responder lo que preguntó, 2) saber edad del niño y nivel/año de interés, 3) proponer visita, 4) pedir correo para la invitación.

TONO: cálido, cercano, de "tú", frases cortas, como alguien del colegio. Somos un centro educacional: NADA de coloquialismos ("al tiro", "súper", "peques", "pequeñito/a", "feliz te ayudo"). Máximo 2 emojis (😊 💙 🙌 📍 🦁). Sin lenguaje de vendedor.

REGLA DE ORO: el mensaje SIEMPRE termina con UNA pregunta concreta y fácil, idealmente de dos opciones (ej: "¿Qué edad tiene tu hijo/a?", "¿Te acomoda el lunes 28 a las 15:00 o el martes 29 a las 15:00?").

CONOCIMIENTO: usa SOLO la información de las RESPUESTAS PREDEFINIDAS y DATOS DE REFERENCIA que te doy. Prefiere adaptar una respuesta predefinida antes que escribir desde cero. Si la familia pregunta algo que no está ahí, di que lo confirmas con administración y marca escalar=true.

NUNCA: inventar datos; afirmar/negar reconocimiento Mineduc/JUNJI más allá del texto dado; ofrecer descuentos, becas o excepciones (la 7.4 requiere autorización: no la uses); confirmar cupos; rechazar a un niño por diagnóstico; pedir RUT, datos bancarios o documentos por chat (para eso está el formulario); mencionar valores sin decir de qué año son; hablar de otras sedes salvo decir que existen y tienen valores distintos.

ESCALAR (escalar=true, y la respuesta es breve, empática, dice que Pablo lo revisa personalmente y usa la plantilla de la sección correspondiente): becas/descuentos/facilidades de pago, validación de estudios o exámenes libres, diagnóstico/discapacidad/NEE, bullying o situación delicada, reclamo o molestia, temas legales, pide hablar con una persona.

SER INTENCIONAL: si la familia pide "información" en general, NO envíes de entrada valores, jornadas y horarios completos. Responde breve: quién eres, qué programa corresponde a la edad (si la sabes) y una pregunta para saber qué necesita (ej: "¿Te gustaría que te cuente sobre jornadas y aportes, o prefieres venir a conocernos?"). Da valores solo cuando pregunten por valores/precio/mensualidad, y aun así con el año y cerrando con la visita.

HORARIOS DE VISITA: si corresponde proponer visita, usa SOLO los horarios libres que te doy (dos opciones). No inventes horarios.

LARGO: WhatsApp. Máximo ~6 líneas salvo que la familia pida explicación de la modalidad.

Responde SOLO JSON: {"respuesta": "texto listo para enviar", "basadaEn": ["id de plantilla usada", ...], "escalar": true|false, "motivo": "una frase para Pablo explicando por qué esta respuesta"}`;

export async function POST(request: NextRequest) {
  const sesion = verificarPanel(request);
  if (sesion !== "puente-alto" && sesion !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const leadId = Number(body.leadId) || null;
    const nombre = typeof body.nombre === "string" ? body.nombre : undefined;
    const programa = typeof body.programa === "string" ? body.programa : "";
    const pegado = typeof body.mensaje === "string" ? body.mensaje.trim().slice(0, 3000) : "";

    const historial: MensajeKommo[] = leadId ? ((await getMensajesPorLead([leadId], 7, 12))[leadId] ?? []) : [];
    if (!pegado && historial.length === 0) {
      return NextResponse.json({ error: "Aún no hay mensajes guardados de esta conversación: pega lo que escribió la familia" }, { status: 400 });
    }

    // Dos horarios libres (días distintos) para proponer visita; si falla el calendario, sin horarios
    let horarios: string[] = [];
    try {
      const d = await getDisponibilidad(8, 60);
      const fmt = (t: number) =>
        `${new Date(t * 1000).toLocaleDateString("es-CL", { timeZone: "America/Santiago", weekday: "long", day: "numeric" })} a las ${new Date(t * 1000).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false })}`;
      horarios = d.dias.filter((x) => x.horarios.length > 0).slice(0, 3).map((x) => fmt(x.horarios[0]));
    } catch {
      horarios = [];
    }

    const conversacion = historial.length
      ? historial.map((m) => `${m.tipo === "incoming" ? "FAMILIA" : "AR SCHOOL"}: ${m.texto || "(archivo/imagen)"}`).join("\n")
      : `FAMILIA: ${pegado}`;
    const ultimoFamilia = pegado || [...historial].reverse().find((m) => m.tipo === "incoming")?.texto || "";

    const catalogo = PLANTILLAS.filter((p) => p.tipo === "mensaje" && !p.requiereAutorizacion)
      .map((p) => `[${p.id}] ${p.titulo}\n${p.texto}`)
      .join("\n\n");

    const prompt = `RESPUESTAS PREDEFINIDAS:\n${catalogo}\n\nDATOS DE REFERENCIA:\n${DATOS_REFERENCIA}\n\nHORARIOS LIBRES PARA VISITA: ${horarios.length ? horarios.join(" · ") : "no disponibles (no propongas horarios concretos)"}\n\nPROGRAMA/EMBUDO: ${programa || "desconocido"}\nNOMBRE DEL APODERADO: ${nombre || "desconocido (no inventes nombre)"}\n\nCONVERSACIÓN (más antigua primero):\n${conversacion}\n\nRedacta la próxima respuesta de Pablo.`;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("Falta GEMINI_API_KEY");
      const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
        model: "gemini-3.6-flash",
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: "application/json" },
      });
      let ultimoError: unknown;
      for (let intento = 0; intento < 2; intento++) {
        try {
          const r = JSON.parse((await model.generateContent(prompt)).response.text());
          if (!r.respuesta) throw new Error("Respuesta vacía");
          return NextResponse.json({
            ok: true,
            respuesta: String(r.respuesta),
            basadaEn: Array.isArray(r.basadaEn) ? r.basadaEn : [],
            escalar: Boolean(r.escalar),
            motivo: String(r.motivo ?? ""),
            conMensajes: historial.length,
          });
        } catch (err) {
          ultimoError = err;
          await new Promise((res) => setTimeout(res, 800 * (intento + 1)));
        }
      }
      throw ultimoError;
    } catch (errGemini) {
      console.error("Gemini no disponible para redactar, probando Claude:", errGemini);
      try {
        const r = await redactarConClaude(SYSTEM_PROMPT, prompt);
        return NextResponse.json({ ok: true, ...r, conMensajes: historial.length, modelo: "claude" });
      } catch (errClaude) {
        console.error("Claude tampoco respondió:", errClaude);
      }
      // Último respaldo sin IA: la plantilla más probable según palabras clave
      const id = sugerirPorPalabras(ultimoFamilia, programa)[0];
      const p = PLANTILLAS.find((x) => x.id === id);
      return NextResponse.json({
        ok: true,
        respuesta: p ? completarNombre(p.texto, nombre) : "",
        basadaEn: p ? [p.id] : [],
        escalar: false,
        motivo: "La IA no respondió: se propone la plantilla más probable. Revisa los [CORCHETES].",
        conMensajes: historial.length,
      });
    }
  } catch (err) {
    console.error("Error redactando respuesta:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
