/**
 * Visitas de admisión desde Google Calendar (solo lectura).
 *
 * Las visitas están en el calendario principal de la cuenta conectada
 * (pencina@armglobal.org). Se clasifican por título:
 * - visita: dice "visita" y además Play / AR School / ARS / Admisión
 *   (así no cuenta, por ejemplo, "Visita terreno CPA")
 * - adaptación: dice "adaptación"
 * VISITAS_CALENDAR_ID permite leer otro calendario (por defecto, "primary").
 */

import { createServiceClient } from "@/lib/supabase/client";
import { getCalendarClient } from "@/lib/gmail/client";

export interface VisitaCalendario {
  titulo: string;
  tipo: "visita" | "adaptacion";
  inicio: number; // unix segundos
  cancelada: boolean;
}

export type ResultadoVisitas =
  | { ok: true; visitas: VisitaCalendario[]; calendario: string }
  | { ok: false; error: string };

export async function getVisitasCalendario(desde: number, hasta: number): Promise<ResultadoVisitas> {
  const calendarId = process.env.VISITAS_CALENDAR_ID || "primary";

  try {
    const { data: cuenta } = await createServiceClient()
      .from("cuentas")
      .select("id")
      .eq("estado", "activa")
      .limit(1)
      .single();
    if (!cuenta) return { ok: false, error: "No hay cuenta de Google activa (hay que reconectarla)" };

    const calendar = await getCalendarClient(cuenta.id);
    const visitas: VisitaCalendario[] = [];
    let pageToken: string | undefined;

    do {
      const res = await calendar.events.list({
        calendarId,
        timeMin: new Date(desde * 1000).toISOString(),
        timeMax: new Date(hasta * 1000).toISOString(),
        singleEvents: true, // expande eventos recurrentes
        orderBy: "startTime",
        showDeleted: false,
        maxResults: 250,
        pageToken,
      });
      for (const ev of res.data.items ?? []) {
        const titulo = (ev.summary ?? "").trim();
        const tipo = clasificar(titulo);
        if (!tipo) continue;
        const inicio = ev.start?.dateTime ?? ev.start?.date;
        if (!inicio) continue;
        visitas.push({ titulo, tipo, inicio: Math.floor(new Date(inicio).getTime() / 1000), cancelada: ev.status === "cancelled" });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return { ok: true, visitas: visitas.filter((v) => !v.cancelada), calendario: calendarId };
  } catch (err) {
    const msg = String(err);
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(msg)) {
      return { ok: false, error: "La API de Google Calendar no está habilitada en el proyecto de Google Cloud de la app" };
    }
    if (/insufficient|scope|403/i.test(msg)) {
      return { ok: false, error: "La cuenta no tiene permiso de calendario: reconectar Google o compartir el calendario" };
    }
    if (/not found|404/i.test(msg)) {
      return { ok: false, error: `No se encontró el calendario "${calendarId}": revisar que esté compartido` };
    }
    return { ok: false, error: msg.slice(0, 200) };
  }
}

/** Tipo de evento según el título, o null si no es de admisión. */
export function clasificar(titulo: string): VisitaCalendario["tipo"] | null {
  const t = titulo.toLowerCase();
  if (/adaptaci[oó]n/.test(t)) return "adaptacion";
  // "ars", "arschool", "arshool", "ar school", "play", "playgroup", "admisión"
  if (/visita/.test(t) && /play|\bar\s?s|admisi/.test(t)) return "visita";
  return null;
}

// ============================================================
// DISPONIBILIDAD Y CREACIÓN DE VISITAS
// ============================================================

/** Horario de atención para visitas (hora Chile). Ajustar aquí si cambia. */
export const HORARIO_VISITAS = {
  dias: [1, 2, 3, 4, 5], // lunes a viernes
  inicio: "08:30",
  fin: "18:00",
  pasoMin: 30, // cada cuánto se ofrece un horario
  anticipacionMin: 120, // no ofrecer horarios que empiecen antes de 2 h desde ahora
};

export const DIRECCION_SEDE = "Av. José Manuel Irarrázaval 0565, Puente Alto";

export interface Ocupado { inicio: number; fin: number; titulo: string }
export interface Slot { inicio: number; libre: boolean; choque?: string } // choque = título del evento que lo bloquea
export interface DiaDisponible {
  fecha: string;
  horarios: number[]; // solo los libres (inicio unix)
  slots: Slot[]; // todos los del horario de atención, libres y ocupados
  eventos: Ocupado[]; // lo que ya está agendado ese día
}

async function calendarioActivo() {
  const { data: cuenta } = await createServiceClient()
    .from("cuentas")
    .select("id")
    .eq("estado", "activa")
    .limit(1)
    .single();
  if (!cuenta) throw new Error("No hay cuenta de Google activa (hay que reconectarla)");
  return { calendar: await getCalendarClient(cuenta.id), calendarId: process.env.VISITAS_CALENDAR_ID || "primary" };
}

/** Unix de una hora "HH:MM" del día "YYYY-MM-DD" en hora Chile. */
function horaChile(fecha: string, hhmm: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const horaEnChile = Number(
    new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", { timeZone: "America/Santiago", hour: "numeric", hour12: false })
  );
  const offset = 12 - horaEnChile; // 3 en verano, 4 en invierno
  return Date.UTC(y, m - 1, d, h + offset, min) / 1000;
}

/** Eventos que bloquean la agenda (no cancelados, no "disponible", no rechazados por mí). */
async function getOcupados(desde: number, hasta: number): Promise<Ocupado[]> {
  const { calendar, calendarId } = await calendarioActivo();
  const ocupados: Ocupado[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId,
      timeMin: new Date(desde * 1000).toISOString(),
      timeMax: new Date(hasta * 1000).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    for (const ev of res.data.items ?? []) {
      if (ev.status === "cancelled" || ev.transparency === "transparent") continue;
      if (ev.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
      const titulo = ev.summary ?? "(sin título)";
      if (ev.start?.dateTime && ev.end?.dateTime) {
        ocupados.push({ inicio: Date.parse(ev.start.dateTime) / 1000, fin: Date.parse(ev.end.dateTime) / 1000, titulo });
      } else if (ev.start?.date && ev.end?.date && ev.eventType === "outOfOffice") {
        // Día completo solo bloquea si es "fuera de la oficina"
        ocupados.push({ inicio: horaChile(ev.start.date, "00:00"), fin: horaChile(ev.end.date, "00:00"), titulo });
      }
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  // Feriados de Chile (calendario público de Google); si no se puede leer, se omite
  try {
    const fer = await calendar.events.list({
      calendarId: "es.cl#holiday@group.v.calendar.google.com",
      timeMin: new Date(desde * 1000).toISOString(),
      timeMax: new Date(hasta * 1000).toISOString(),
      singleEvents: true,
    });
    for (const ev of fer.data.items ?? []) {
      if (ev.start?.date && ev.end?.date) {
        ocupados.push({ inicio: horaChile(ev.start.date, "00:00"), fin: horaChile(ev.end.date, "00:00"), titulo: `Feriado: ${ev.summary}` });
      }
    }
  } catch {
    // sin feriados
  }
  return ocupados;
}

function fechaDe(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

/**
 * Horarios libres para una visita de `duracionMin` en los próximos `diasHabiles` días hábiles.
 * Además devuelve las visitas/adaptaciones ya agendadas en ese período.
 */
export async function getDisponibilidad(diasHabiles = 10, duracionMin = 60) {
  const ahora = Math.floor(Date.now() / 1000);
  // Fechas candidatas (hoy incluido) hasta juntar N días hábiles
  const fechas: string[] = [];
  for (let i = 0; fechas.length < diasHabiles && i < 40; i++) {
    const f = fechaDe(ahora + i * 86400);
    const dia = new Date(`${f}T12:00:00Z`).getUTCDay();
    if (HORARIO_VISITAS.dias.includes(dia)) fechas.push(f);
  }
  const desde = horaChile(fechas[0], "00:00");
  const hasta = horaChile(fechas[fechas.length - 1], "23:59");
  const ocupados = await getOcupados(desde, hasta);

  const dias: DiaDisponible[] = fechas.map((fecha) => {
    const slots: Slot[] = [];
    const fin = horaChile(fecha, HORARIO_VISITAS.fin);
    for (let t = horaChile(fecha, HORARIO_VISITAS.inicio); t + duracionMin * 60 <= fin; t += HORARIO_VISITAS.pasoMin * 60) {
      if (t < ahora + HORARIO_VISITAS.anticipacionMin * 60) continue;
      const tFin = t + duracionMin * 60;
      const choque = ocupados.find((o) => o.inicio < tFin && o.fin > t);
      slots.push(choque ? { inicio: t, libre: false, choque: choque.titulo } : { inicio: t, libre: true });
    }
    const iniDia = horaChile(fecha, "00:00");
    const finDia = horaChile(fecha, "23:59");
    const eventos = ocupados
      .filter((o) => o.inicio < finDia && o.fin > iniDia)
      .sort((a, b) => a.inicio - b.inicio);
    return { fecha, horarios: slots.filter((x) => x.libre).map((x) => x.inicio), slots, eventos };
  });

  const visitas = (await getVisitasCalendario(ahora, hasta));
  return {
    dias,
    agendadas: visitas.ok ? visitas.visitas.filter((v) => v.inicio >= ahora) : [],
    ocupadosCount: ocupados.length,
  };
}

export interface NuevaVisita {
  programa: "Play Group" | "AR School";
  detalle: string; // ej: "Lucas 3 años" o "Náyaret Ávila - 5 y 8 años"
  inicio: number; // unix
  duracionMin: number;
  emailFamilia?: string; // si viene, se invita y Google le envía la invitación
  leadUrl?: string;
}

/** Eventos del calendario que se cruzan con [inicio, inicio + duración). */
export async function verificarHorario(inicio: number, duracionMin: number): Promise<Ocupado[]> {
  const fin = inicio + duracionMin * 60;
  return (await getOcupados(inicio - 86400, fin + 86400)).filter((o) => o.inicio < fin && o.fin > inicio);
}

/**
 * Crea la visita en el calendario. Verifica antes que el horario siga libre; con
 * `forzar` se agenda igual (p. ej. dos visitas a la misma hora, a propósito).
 */
export async function crearVisita(v: NuevaVisita & { forzar?: boolean }): Promise<{ id: string; link: string; titulo: string }> {
  const fin = v.inicio + v.duracionMin * 60;
  const choques = await verificarHorario(v.inicio, v.duracionMin);
  if (choques.length > 0 && !v.forzar) throw new Error(`Ese horario ya no está libre (choca con: ${choques[0].titulo})`);

  const { calendar, calendarId } = await calendarioActivo();
  const titulo = `Visita Admisión | ${v.programa} | ${v.detalle.trim()}`;
  const res = await calendar.events.insert({
    calendarId,
    sendUpdates: v.emailFamilia ? "all" : "none",
    requestBody: {
      summary: titulo,
      location: DIRECCION_SEDE,
      description: ["Visita agendada desde el panel Insiste.", v.leadUrl ? `Lead en Kommo: ${v.leadUrl}` : ""].filter(Boolean).join("\n"),
      start: { dateTime: new Date(v.inicio * 1000).toISOString(), timeZone: "America/Santiago" },
      end: { dateTime: new Date(fin * 1000).toISOString(), timeZone: "America/Santiago" },
      attendees: v.emailFamilia ? [{ email: v.emailFamilia }] : undefined,
    },
  });
  return { id: res.data.id ?? "", link: res.data.htmlLink ?? "", titulo };
}
