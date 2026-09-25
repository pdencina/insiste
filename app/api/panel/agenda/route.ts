/**
 * API Panel: Agenda de visitas (Google Calendar de pencina@armglobal.org)
 *
 * GET  /api/panel/agenda?dias=10&duracion=60 → horarios (libres y ocupados) + visitas agendadas
 * GET  /api/panel/agenda?verificar=<unix>&duracion=60 → con qué se cruza ese horario puntual
 * POST /api/panel/agenda  Body: { programa, detalle, inicio, duracionMin, emailFamilia?, leadUrl?, forzar? }
 *      → crea la visita (verifica antes que siga libre; con forzar=true agenda igual)
 *
 * Solo la sede Puente Alto (el calendario es de Pablo Encina) o el admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { verificarPanel } from "@/lib/panel/sesion";
import { crearVisita, getDisponibilidad, verificarHorario } from "@/lib/google/calendario";

export const maxDuration = 60;

function autorizado(request: NextRequest): boolean {
  const sesion = verificarPanel(request);
  return sesion === "puente-alto" || sesion === "admin";
}

export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const dias = Math.min(20, Math.max(1, Number(params.get("dias")) || 10));
  const duracion = [30, 45, 60, 90].includes(Number(params.get("duracion"))) ? Number(params.get("duracion")) : 60;

  try {
    const verificar = Number(params.get("verificar"));
    if (verificar) {
      const choques = await verificarHorario(verificar, duracion);
      return NextResponse.json({ ok: true, inicio: verificar, duracion, choques });
    }
    const d = await getDisponibilidad(dias, duracion);
    return NextResponse.json({ ok: true, duracion, ...d });
  } catch (err) {
    console.error("Error leyendo agenda:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const programa = body.programa === "AR School" ? "AR School" : body.programa === "Play Group" ? "Play Group" : null;
    const detalle = String(body.detalle ?? "").trim().slice(0, 120);
    const inicio = Number(body.inicio);
    const duracionMin = [30, 45, 60, 90].includes(Number(body.duracionMin)) ? Number(body.duracionMin) : 60;
    const emailFamilia = typeof body.emailFamilia === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.emailFamilia.trim())
      ? body.emailFamilia.trim()
      : undefined;
    const leadUrl = typeof body.leadUrl === "string" && body.leadUrl.startsWith("https://") ? body.leadUrl : undefined;

    if (!programa || !detalle || !Number.isFinite(inicio)) {
      return NextResponse.json({ error: "Faltan datos: programa, nombre/detalle y horario" }, { status: 400 });
    }
    if (inicio < Date.now() / 1000) {
      return NextResponse.json({ error: "Ese horario ya pasó" }, { status: 400 });
    }

    const creada = await crearVisita({ programa, detalle, inicio, duracionMin, emailFamilia, leadUrl, forzar: body.forzar === true });
    return NextResponse.json({ ok: true, ...creada, invitacionEnviada: Boolean(emailFamilia) });
  } catch (err) {
    const msg = String(err);
    const status = /ya no está libre/.test(msg) ? 409 : /insufficient|403/i.test(msg) ? 403 : 500;
    return NextResponse.json({
      error: status === 403 ? "Falta permiso para crear eventos: reconecta Google en /api/auth/login" : msg.replace(/^Error: /, ""),
    }, { status });
  }
}
