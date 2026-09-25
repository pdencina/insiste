/**
 * Enviar una respuesta por WhatsApp desde Insiste.
 *
 * La API de Kommo no permite enviar mensajes de WhatsApp directamente, así que:
 * 1. se escribe el texto en el campo del lead "Respuesta Insiste"
 * 2. se lanza el Salesbot "Enviar respuesta Insiste", cuyo único paso es enviar
 *    ese campo al chat del lead (sale desde el número de AR School, como hoy).
 * Ambos se buscan por nombre, así no hay IDs fijos en el código.
 */

import { kommoFetch } from "@/lib/kommo/client";
import { getMensajesPorLead } from "@/lib/kommo/mensajes";

export const NOMBRE_CAMPO = "Respuesta Insiste";
export const NOMBRE_BOT = "Enviar respuesta Insiste";
const VENTANA_HORAS = 24;

async function buscarCampo(): Promise<number | null> {
  const res = await kommoFetch("/leads/custom_fields?limit=250");
  if (!res.ok) return null;
  const campos: { id: number; name: string }[] = (await res.json())?._embedded?.custom_fields ?? [];
  return campos.find((c) => c.name === NOMBRE_CAMPO)?.id ?? null;
}

async function buscarBot(): Promise<number | null> {
  const res = await kommoFetch("/bots?limit=250");
  if (!res.ok) return null;
  const data = await res.json();
  const bots: { id: number; name: string; settings?: { active?: boolean } }[] = data?._embedded?.items ?? data?._embedded?.bots ?? [];
  return bots.find((b) => b.name.trim().toLowerCase() === NOMBRE_BOT.toLowerCase())?.id ?? null;
}

/**
 * Último mensaje de la familia (unix) dentro de las últimas 24 h, o null.
 * El filtro por entidad de /events no funciona para mensajes de chat, así que se
 * recorren los entrantes de las últimas 24 h (pocas páginas) y se suman los
 * guardados por el webhook.
 */
export async function ultimoMensajeFamilia(leadId: number): Promise<number | null> {
  const desde = Math.floor(Date.now() / 1000) - VENTANA_HORAS * 3600;
  let ultimo: number | null = null;
  for (let page = 1; page <= 10; page++) {
    const res = await kommoFetch(`/events?filter[type]=incoming_chat_message&filter[created_at][from]=${desde}&limit=100&page=${page}`);
    if (!res.ok || res.status === 204) break;
    const eventos: { entity_id: number; created_at: number }[] = (await res.json())?._embedded?.events ?? [];
    for (const e of eventos) if (e.entity_id === leadId && e.created_at > (ultimo ?? 0)) ultimo = e.created_at;
    if (eventos.length < 100) break;
  }
  const guardados = (await getMensajesPorLead([leadId], 1, 50))[leadId] ?? [];
  for (const m of guardados) if (m.tipo === "incoming" && m.creadoEn > (ultimo ?? 0)) ultimo = m.creadoEn;
  return ultimo;
}

/** Estado de la configuración en Kommo (para mostrar en el panel qué falta). */
export async function estadoConfiguracion() {
  const [campoId, botId] = await Promise.all([buscarCampo(), buscarBot()]);
  return { campoId, botId, listo: Boolean(campoId && botId) };
}

export async function enviarRespuesta(leadId: number, texto: string): Promise<void> {
  const limpio = texto.trim();
  if (!limpio) throw new Error("El mensaje está vacío");
  if (limpio.length > 4000) throw new Error("El mensaje es demasiado largo (máx. 4000 caracteres)");

  const [campoId, botId, ultimo] = await Promise.all([buscarCampo(), buscarBot(), ultimoMensajeFamilia(leadId)]);
  if (!campoId) throw new Error(`Falta el campo "${NOMBRE_CAMPO}" en los leads de Kommo`);
  if (!botId) throw new Error(`Falta crear el Salesbot "${NOMBRE_BOT}" en Kommo`);
  if (!ultimo || Date.now() / 1000 - ultimo > VENTANA_HORAS * 3600) {
    throw new Error("La ventana de 24 h de WhatsApp está cerrada: la familia no ha escrito en las últimas 24 horas");
  }

  // 1) Guardar el texto en el lead
  const upd = await kommoFetchJson("PATCH", "/leads", [
    { id: leadId, custom_fields_values: [{ field_id: campoId, values: [{ value: limpio }] }] },
  ]);
  if (!upd.ok) throw new Error(`No se pudo guardar la respuesta en el lead (${upd.status})`);

  // 2) Lanzar el Salesbot que la envía (API v2)
  const run = await kommoFetchJson("POST", "/salesbot/run", [{ bot_id: botId, entity_id: leadId, entity_type: 2 }], "v2");
  if (!run.ok) {
    throw new Error(
      run.status === 400 && /already|running/i.test(run.texto)
        ? "Ya hay un Salesbot corriendo para este lead; espera unos segundos y vuelve a intentar"
        : `Kommo no pudo lanzar el Salesbot (${run.status})`
    );
  }
}

/** kommoFetch con método y cuerpo JSON. `version` permite usar la API v2 (salesbot/run). */
async function kommoFetchJson(method: string, path: string, body: unknown, version: "v4" | "v2" = "v4") {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  const res = await fetch(`https://${subdomain}.kommo.com/api/${version}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, texto: await res.text() };
}
