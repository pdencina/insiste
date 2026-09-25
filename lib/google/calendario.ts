/**
 * Visitas de admisión desde Google Calendar (solo lectura).
 *
 * Las visitas están en el calendario personal de Pablo, compartido en modo
 * "ver todos los detalles" con la cuenta conectada a la app (pencina@armglobal.org).
 * - VISITAS_CALENDAR_ID: ID del calendario (el correo personal). Si falta, usa el
 *   calendario principal de la cuenta conectada.
 * - VISITAS_PALABRAS: palabras que identifican una visita en el título, separadas
 *   por coma (por defecto "visita").
 */

import { createServiceClient } from "@/lib/supabase/client";
import { getCalendarClient } from "@/lib/gmail/client";

export interface VisitaCalendario {
  titulo: string;
  inicio: number; // unix segundos
  cancelada: boolean;
}

export type ResultadoVisitas =
  | { ok: true; visitas: VisitaCalendario[]; calendario: string }
  | { ok: false; error: string };

export async function getVisitasCalendario(desde: number, hasta: number): Promise<ResultadoVisitas> {
  const calendarId = process.env.VISITAS_CALENDAR_ID || "primary";
  const palabras = (process.env.VISITAS_PALABRAS || "visita")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

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
        const titulo = ev.summary ?? "";
        if (!palabras.some((p) => titulo.toLowerCase().includes(p))) continue;
        const inicio = ev.start?.dateTime ?? ev.start?.date;
        if (!inicio) continue;
        visitas.push({ titulo, inicio: Math.floor(new Date(inicio).getTime() / 1000), cancelada: ev.status === "cancelled" });
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
