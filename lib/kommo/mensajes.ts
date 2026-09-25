/**
 * Mensajes de chat de Kommo recibidos por webhook.
 *
 * La API REST de Kommo no entrega el texto de los mensajes; el webhook de cuenta
 * "mensaje entrante / saliente" sí. Se guardan en la tabla `eventos`
 * (accion = "kommo_mensaje") para que el panel muestre qué escribió cada familia.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/client";

export interface MensajeKommo {
  id: string;
  leadId: number | null;
  contactId: number | null;
  talkId: number | null;
  texto: string;
  tipo: "incoming" | "outgoing";
  autor: string | null;
  origen: string | null;
  creadoEn: number; // unix
}

/** Token del webhook: derivado de CRON_SECRET (no requiere otra variable de entorno). */
export function tokenWebhook(): string {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) throw new Error("Falta CRON_SECRET");
  return createHmac("sha256", secreto).update("kommo-webhook").digest("base64url").slice(0, 32);
}

export function tokenValido(token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(tokenWebhook());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** "message[add][0][author][name]=X" → { message: { add: { "0": { author: { name: "X" } } } } } */
export function parsearFormulario(cuerpo: string): Record<string, unknown> {
  const raiz: Record<string, unknown> = {};
  for (const [clave, valor] of new URLSearchParams(cuerpo)) {
    const partes = clave.replace(/\]/g, "").split("[");
    let nodo = raiz;
    partes.forEach((p, i) => {
      if (i === partes.length - 1) nodo[p] = valor;
      else nodo = (nodo[p] ??= {}) as Record<string, unknown>;
    });
  }
  return raiz;
}

type Crudo = Record<string, unknown> & { author?: Record<string, unknown> };

/** Extrae los mensajes del payload del webhook (formulario o JSON). */
export function extraerMensajes(payload: Record<string, unknown>): MensajeKommo[] {
  const bloque = (payload.message as Record<string, unknown> | undefined)?.add;
  if (!bloque || typeof bloque !== "object") return [];
  const lista = Array.isArray(bloque) ? bloque : Object.values(bloque);
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  return (lista as Crudo[])
    .map((m) => {
      const tipoEntidad = String(m.entity_type ?? m.element_type ?? "");
      const esLead = tipoEntidad === "lead" || tipoEntidad === "leads" || tipoEntidad === "2";
      return {
        id: String(m.id ?? ""),
        leadId: esLead ? num(m.entity_id ?? m.element_id) : null,
        contactId: num(m.contact_id),
        talkId: num(m.talk_id),
        texto: String(m.text ?? "").slice(0, 4000),
        tipo: (String(m.type) === "outgoing" ? "outgoing" : "incoming") as MensajeKommo["tipo"],
        autor: m.author?.name ? String(m.author.name) : null,
        origen: m.origin ? String(m.origin) : null,
        creadoEn: num(m.created_at) ?? Math.floor(Date.now() / 1000),
      };
    })
    .filter((m) => m.id && (m.texto || m.tipo === "incoming"));
}

async function userIdCuenta(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("cuentas").select("user_id, estado").order("estado", { ascending: true }).limit(5);
  const activa = data?.find((c) => c.estado === "activa") ?? data?.[0];
  return activa?.user_id ?? null;
}

export async function guardarMensajes(mensajes: MensajeKommo[]): Promise<number> {
  if (mensajes.length === 0) return 0;
  const userId = await userIdCuenta();
  if (!userId) throw new Error("No hay cuenta para asociar los mensajes");
  const { error } = await createServiceClient()
    .from("eventos")
    .insert(mensajes.map((m) => ({ user_id: userId, accion: "kommo_mensaje", detalle: m })));
  if (error) throw new Error(error.message);
  return mensajes.length;
}

/** Últimos mensajes por lead (más antiguos primero), de los últimos `dias` días. */
export async function getMensajesPorLead(leadIds: number[], dias = 7, porLead = 8): Promise<Record<number, MensajeKommo[]>> {
  const resultado: Record<number, MensajeKommo[]> = {};
  if (leadIds.length === 0) return resultado;
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data, error } = await createServiceClient()
    .from("eventos")
    .select("detalle")
    .eq("accion", "kommo_mensaje")
    .gte("creado_en", desde)
    .in("detalle->>leadId", leadIds.map(String))
    .order("creado_en", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  const vistos = new Set<string>();
  for (const fila of data ?? []) {
    const m = fila.detalle as MensajeKommo;
    if (!m.leadId || vistos.has(m.id)) continue; // Kommo puede reenviar el mismo mensaje
    vistos.add(m.id);
    (resultado[m.leadId] ??= []).push(m);
  }
  for (const id of Object.keys(resultado)) resultado[Number(id)] = resultado[Number(id)].slice(-porLead);
  return resultado;
}
