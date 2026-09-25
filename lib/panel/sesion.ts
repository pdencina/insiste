/**
 * Sesión del panel de sede.
 *
 * La clave de cada sede se valida en el servidor (antes estaba en el código del
 * navegador) y se entrega un token firmado con CRON_SECRET que las rutas del
 * panel exigen en el header "x-sede-token". El admin sigue usando
 * "Authorization: Bearer <CRON_SECRET>".
 *
 * Claves: variables PANEL_CLAVE_PUENTE_ALTO / _SANTIAGO / _PUNTA_ARENAS en Vercel.
 * Si no están definidas se usan las claves históricas, para no dejar a nadie fuera.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const DIAS_SESION = 30;

const CLAVES: Record<string, string | undefined> = {
  "puente-alto": process.env.PANEL_CLAVE_PUENTE_ALTO ?? "pa2026",
  santiago: process.env.PANEL_CLAVE_SANTIAGO ?? "stgo2026",
  "punta-arenas": process.env.PANEL_CLAVE_PUNTA_ARENAS ?? "ptas2026",
};

function firmar(datos: string): string {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) throw new Error("Falta CRON_SECRET");
  return createHmac("sha256", secreto).update(datos).digest("base64url");
}

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Valida la clave de una sede y devuelve un token, o null si no corresponde. */
export function iniciarSesion(slug: string, clave: string): string | null {
  const esperada = CLAVES[slug]?.trim();
  // Se ignoran espacios al inicio/fin (autocompletado del navegador o del celular)
  if (!esperada || !iguales(clave.trim(), esperada)) return null;
  const expira = Math.floor(Date.now() / 1000) + DIAS_SESION * 86400;
  const datos = `${slug}.${expira}`;
  return `${datos}.${firmar(datos)}`;
}

/** Sede del token (o "admin" con CRON_SECRET); null si no hay sesión válida. */
export function verificarPanel(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return "admin";

  const token = request.headers.get("x-sede-token") ?? "";
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [slug, expira, firma] = partes;
  if (!CLAVES[slug] || Number(expira) < Date.now() / 1000) return null;
  return iguales(firma, firmar(`${slug}.${expira}`)) ? slug : null;
}
