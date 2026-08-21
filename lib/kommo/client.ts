/**
 * Cliente para la API de Kommo CRM.
 *
 * Obtiene conversaciones abiertas y calcula el tiempo restante
 * antes de que expire la ventana de 24h de WhatsApp.
 */

const VENTANA_HORAS = 24;

// SLA Comercial — umbrales de tiempo de respuesta
const SLA = {
  ATENDIDO: 5,        // <5 min = ideal
  PENDIENTE: 30,      // 5-30 min = aceptable
  DEMORADO: 120,      // 30min-2h = urgente, se enfría
  FRIO: 1440,         // 2h-24h = probablemente perdido
  // >24h = expirado (ventana cerrada)
};

// Mapeo de responsables por sede (pipeline)
export const RESPONSABLES_SEDE: Record<string, { nombre: string; email: string; sede: string }> = {
  "puente alto": { nombre: "Pr Pablo", email: "pencina@armglobal.org", sede: "Puente Alto" },
  "santiago": { nombre: "Pr Patricio Andrés", email: "paburgos@armglobal.org", sede: "Santiago" },
  "punta arenas": { nombre: "Pastor Jesús", email: "jcamargo@armglobal.org", sede: "Punta Arenas" },
};

export interface KommoConversation {
  id: number;
  contactId: number;
  contactName: string;
  leadId: number | null;
  leadName: string | null;
  pipelineName: string | null;
  sede: string | null;
  lastMessageAt: number;
  horasRestantes: number;
  minutosRestantes: number;
  minutosSinResponder: number;
  estado: "atendido" | "pendiente" | "demorado" | "frio" | "expirado";
  estadoLabel: string;
  isRead: boolean;
  origin: string;
}

interface KommoApiOptions {
  token: string;
  subdomain: string;
}

function getKommoOptions(): KommoApiOptions {
  const token = process.env.KOMMO_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;
  if (!token || !subdomain) {
    throw new Error("Faltan variables KOMMO_TOKEN o KOMMO_SUBDOMAIN");
  }
  return { token, subdomain };
}

async function kommoFetch(path: string, options?: KommoApiOptions): Promise<Response> {
  const { token, subdomain } = options ?? getKommoOptions();
  const url = `https://${subdomain}.kommo.com/api/v4${path}`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * Obtiene los pipelines de la cuenta para mapear a sedes.
 */
async function getPipelines(): Promise<Map<number, string>> {
  const res = await kommoFetch("/leads/pipelines");
  if (!res.ok) return new Map();

  const data = await res.json();
  const pipelines = data?._embedded?.pipelines ?? [];
  const map = new Map<number, string>();

  for (const pipeline of pipelines) {
    map.set(pipeline.id, pipeline.name ?? `Pipeline #${pipeline.id}`);
  }

  return map;
}

/**
 * Detecta la sede a partir del nombre del pipeline.
 */
function detectarSede(pipelineName: string | null): string | null {
  if (!pipelineName) return null;
  const lower = pipelineName.toLowerCase();

  if (lower.includes("puente alto")) return "Puente Alto";
  if (lower.includes("punta arenas")) return "Punta Arenas";
  if (lower.includes("santiago")) return "Santiago";

  // Fallback: buscar keywords más amplios
  for (const key of Object.keys(RESPONSABLES_SEDE)) {
    if (lower.includes(key)) return RESPONSABLES_SEDE[key].sede;
  }

  return pipelineName; // Si no matchea, mostrar el nombre original
}

/**
 * Obtiene los nombres de contactos por IDs.
 */
async function getContactNames(contactIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (contactIds.length === 0) return map;

  // Kommo permite hasta 250 por request, procesar en batches
  const batches = [];
  for (let i = 0; i < contactIds.length; i += 50) {
    batches.push(contactIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const query = batch.map((id) => `filter[id][]=${id}`).join("&");
      const res = await kommoFetch(`/contacts?${query}&limit=50`);
      if (!res.ok) continue;

      const data = await res.json();
      const contacts = data?._embedded?.contacts ?? [];
      for (const contact of contacts) {
        map.set(contact.id, contact.name ?? `Contacto #${contact.id}`);
      }
    } catch {
      // Continuar con el siguiente batch
    }
  }

  return map;
}

/**
 * Obtiene leads por IDs para saber el pipeline.
 */
async function getLeadPipelines(leadIds: number[]): Promise<Map<number, { name: string; pipelineId: number }>> {
  const map = new Map<number, { name: string; pipelineId: number }>();
  if (leadIds.length === 0) return map;

  const batches = [];
  for (let i = 0; i < leadIds.length; i += 50) {
    batches.push(leadIds.slice(i, i + 50));
  }

  for (const batch of batches) {
    try {
      const query = batch.map((id) => `filter[id][]=${id}`).join("&");
      const res = await kommoFetch(`/leads?${query}&limit=50`);
      if (!res.ok) continue;

      const data = await res.json();
      const leads = data?._embedded?.leads ?? [];
      for (const lead of leads) {
        map.set(lead.id, { name: lead.name ?? "", pipelineId: lead.pipeline_id });
      }
    } catch {
      // Continuar
    }
  }

  return map;
}

/**
 * Obtiene todas las conversaciones abiertas con nombres y sedes.
 */
export async function getConversacionesAbiertas(): Promise<KommoConversation[]> {
  const opts = getKommoOptions();

  // Obtener conversaciones abiertas
  const response = await kommoFetch("/talks?filter[is_in_work]=true&limit=250", opts);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kommo API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  const talks = data?._embedded?.talks ?? [];

  // Recopilar IDs para enriquecer
  const contactIds: number[] = [];
  const leadIds: number[] = [];

  for (const talk of talks) {
    const contactId = talk._embedded?.contacts?.[0]?.id ?? talk.contact_id;
    if (contactId) contactIds.push(contactId);
    const leadId = talk._embedded?.leads?.[0]?.id ?? talk.entity_id;
    if (leadId) leadIds.push(leadId);
  }

  // Obtener datos en paralelo
  const [contactNames, leadPipelines, pipelines] = await Promise.all([
    getContactNames([...new Set(contactIds)]),
    getLeadPipelines([...new Set(leadIds.filter(Boolean))]),
    getPipelines(),
  ]);

  const ahora = Math.floor(Date.now() / 1000);
  const conversaciones: KommoConversation[] = [];

  for (const talk of talks) {
    const lastMessageAt = talk.updated_at ?? talk.created_at;
    const segundosTranscurridos = ahora - lastMessageAt;
    const horasTranscurridas = segundosTranscurridos / 3600;
    const horasRestantes = VENTANA_HORAS - horasTranscurridas;
    const minutosRestantes = Math.max(0, Math.round(horasRestantes * 60));
    const minutosSinResponder = Math.round(segundosTranscurridos / 60);

    // Clasificación por SLA comercial
    let estado: KommoConversation["estado"];
    let estadoLabel: string;
    if (horasRestantes <= 0) {
      estado = "expirado";
      estadoLabel = "Expirado";
    } else if (minutosSinResponder >= SLA.FRIO) {
      estado = "frio";
      estadoLabel = "Frío";
    } else if (minutosSinResponder >= SLA.DEMORADO) {
      estado = "demorado";
      estadoLabel = "Demorado";
    } else if (minutosSinResponder >= SLA.PENDIENTE) {
      estado = "pendiente";
      estadoLabel = "Pendiente";
    } else {
      estado = "atendido";
      estadoLabel = "Atendido";
    }

    const contactId = talk._embedded?.contacts?.[0]?.id ?? talk.contact_id;
    const leadId = talk._embedded?.leads?.[0]?.id ?? talk.entity_id;

    const contactName = contactNames.get(contactId) ?? `Contacto #${contactId}`;
    const leadInfo = leadId ? leadPipelines.get(leadId) : null;
    const pipelineName = leadInfo ? (pipelines.get(leadInfo.pipelineId) ?? null) : null;
    const sede = detectarSede(pipelineName);

    conversaciones.push({
      id: talk.id,
      contactId,
      contactName,
      leadId: leadId ?? null,
      leadName: leadInfo?.name ?? null,
      pipelineName,
      sede,
      lastMessageAt,
      horasRestantes: Math.max(0, parseFloat(horasRestantes.toFixed(1))),
      minutosRestantes,
      minutosSinResponder,
      estado,
      estadoLabel,
      isRead: talk.is_read ?? true,
      origin: talk.origin ?? "whatsapp",
    });
  }

  // Ordenar: los que necesitan atención más urgente primero
  const orden = { demorado: 0, pendiente: 1, frio: 2, expirado: 3, atendido: 4 };
  conversaciones.sort((a, b) => {
    const diff = orden[a.estado] - orden[b.estado];
    if (diff !== 0) return diff;
    return b.minutosSinResponder - a.minutosSinResponder;
  });

  return conversaciones;
}

/**
 * Resumen de alertas por sede.
 */
export interface AlertaResumen {
  total: number;
  atendidos: number;
  pendientes: number;
  demorados: number;
  frios: number;
  expirados: number;
  tiempoPromedioMin: number;
}

export interface AlertaPorSede {
  sede: string;
  responsable: string;
  email: string;
  demorados: number;
  pendientes: number;
  frios: number;
  expirados: number;
  conversaciones: KommoConversation[];
}

export function calcularResumen(conversaciones: KommoConversation[]): AlertaResumen {
  const tiempos = conversaciones.map((c) => c.minutosSinResponder);
  const promedio = tiempos.length > 0 ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : 0;

  return {
    total: conversaciones.length,
    atendidos: conversaciones.filter((c) => c.estado === "atendido").length,
    pendientes: conversaciones.filter((c) => c.estado === "pendiente").length,
    demorados: conversaciones.filter((c) => c.estado === "demorado").length,
    frios: conversaciones.filter((c) => c.estado === "frio").length,
    expirados: conversaciones.filter((c) => c.estado === "expirado").length,
    tiempoPromedioMin: promedio,
  };
}

export function agruparPorSede(conversaciones: KommoConversation[]): AlertaPorSede[] {
  const porSede = new Map<string, KommoConversation[]>();

  for (const conv of conversaciones) {
    const sede = conv.sede ?? "Sin sede";
    if (!porSede.has(sede)) porSede.set(sede, []);
    porSede.get(sede)!.push(conv);
  }

  const resultado: AlertaPorSede[] = [];

  for (const [sede, convs] of porSede) {
    const sedeKey = sede.toLowerCase();
    const responsable = RESPONSABLES_SEDE[sedeKey];

    resultado.push({
      sede,
      responsable: responsable?.nombre ?? "Sin asignar",
      email: responsable?.email ?? "",
      demorados: convs.filter((c) => c.estado === "demorado").length,
      pendientes: convs.filter((c) => c.estado === "pendiente").length,
      frios: convs.filter((c) => c.estado === "frio").length,
      expirados: convs.filter((c) => c.estado === "expirado").length,
      conversaciones: convs.filter((c) => c.estado !== "atendido"),
    });
  }

  resultado.sort((a, b) => (b.demorados + b.pendientes) - (a.demorados + a.pendientes));
  return resultado;
}
