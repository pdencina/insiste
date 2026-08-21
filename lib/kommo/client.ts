/**
 * Cliente para la API de Kommo CRM.
 *
 * Obtiene conversaciones abiertas y calcula el tiempo restante
 * antes de que expire la ventana de 24h de WhatsApp.
 */

const VENTANA_HORAS = 24;

export interface KommoConversation {
  id: number;
  contactId: number;
  contactName: string;
  leadId: number | null;
  leadName: string | null;
  pipelineName: string | null;
  lastMessageAt: number; // Unix timestamp seconds
  horasRestantes: number;
  minutosRestantes: number;
  estado: "critico" | "alerta" | "ok" | "expirado";
  isRead: boolean;
  origin: string;
}

/**
 * Obtiene todas las conversaciones abiertas y calcula el countdown.
 */
export async function getConversacionesAbiertas(): Promise<KommoConversation[]> {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;

  if (!token || !subdomain) {
    throw new Error("Faltan variables KOMMO_TOKEN o KOMMO_SUBDOMAIN");
  }

  const baseUrl = `https://${subdomain}.kommo.com/api/v4`;

  // Obtener conversaciones abiertas (is_in_work)
  const response = await fetch(`${baseUrl}/talks?filter[is_in_work]=true&limit=250`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kommo API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const talks = data?._embedded?.talks ?? [];

  const ahora = Math.floor(Date.now() / 1000);
  const conversaciones: KommoConversation[] = [];

  for (const talk of talks) {
    const lastMessageAt = talk.updated_at ?? talk.created_at;
    const segundosTranscurridos = ahora - lastMessageAt;
    const horasTranscurridas = segundosTranscurridos / 3600;
    const horasRestantes = VENTANA_HORAS - horasTranscurridas;
    const minutosRestantes = Math.max(0, Math.round(horasRestantes * 60));

    let estado: KommoConversation["estado"];
    if (horasRestantes <= 0) {
      estado = "expirado";
    } else if (horasRestantes <= 2) {
      estado = "critico";
    } else if (horasRestantes <= 6) {
      estado = "alerta";
    } else {
      estado = "ok";
    }

    // Extraer info del contacto y lead
    const contact = talk._embedded?.contacts?.[0];
    const lead = talk._embedded?.leads?.[0];

    conversaciones.push({
      id: talk.id,
      contactId: contact?.id ?? talk.contact_id,
      contactName: contact?.name ?? `Contacto #${talk.contact_id}`,
      leadId: lead?.id ?? talk.entity_id ?? null,
      leadName: lead?.name ?? null,
      pipelineName: null, // Se enriquece después si es necesario
      lastMessageAt,
      horasRestantes: Math.max(0, parseFloat(horasRestantes.toFixed(1))),
      minutosRestantes,
      estado,
      isRead: talk.is_read ?? true,
      origin: talk.origin ?? "whatsapp",
    });
  }

  // Ordenar: expirados y críticos primero
  const orden = { expirado: 0, critico: 1, alerta: 2, ok: 3 };
  conversaciones.sort((a, b) => {
    const diff = orden[a.estado] - orden[b.estado];
    if (diff !== 0) return diff;
    return a.horasRestantes - b.horasRestantes;
  });

  return conversaciones;
}

/**
 * Resumen de alertas para mostrar en el panel.
 */
export interface AlertaResumen {
  total: number;
  expirados: number;
  criticos: number;
  alertas: number;
  ok: number;
}

export function calcularResumen(conversaciones: KommoConversation[]): AlertaResumen {
  return {
    total: conversaciones.length,
    expirados: conversaciones.filter((c) => c.estado === "expirado").length,
    criticos: conversaciones.filter((c) => c.estado === "critico").length,
    alertas: conversaciones.filter((c) => c.estado === "alerta").length,
    ok: conversaciones.filter((c) => c.estado === "ok").length,
  };
}
