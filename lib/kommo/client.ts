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

  // Obtener TODAS las conversaciones abiertas (Kommo pagina de a 250).
  // Solo se muestran las con movimiento en los últimos DIAS_PANEL días: las más
  // viejas ya expiraron hace rato y solo agregan ruido (y requests de enriquecimiento).
  const DIAS_PANEL = 7;
  const limite = Math.floor(Date.now() / 1000) - DIAS_PANEL * 86400;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- respuesta cruda de Kommo, igual que el resto del archivo
  const talks: any[] = [];

  for (let page = 1; page <= 20; page++) {
    const response = await kommoFetch(`/talks?filter[is_in_work]=true&limit=250&page=${page}`, opts);
    if (response.status === 204) break;
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kommo API error ${response.status}: ${error}`);
    }

    const data = await response.json();
    const pagina = data?._embedded?.talks ?? [];
    // Kommo ignora filter[is_in_work] y devuelve también las cerradas: filtrar acá
    talks.push(
      ...pagina.filter(
        (t: { updated_at?: number; created_at: number; is_in_work?: boolean; status?: string }) =>
          t.is_in_work !== false && t.status !== "closed" && (t.updated_at ?? t.created_at) >= limite
      )
    );
    if (pagina.length < 250) break;
  }

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

// ============================================================
// CHATS SIN ACEPTAR (Incoming leads / unsorted)
// ============================================================

export interface ChatSinClasificar {
  uid: string;
  leadId: number | null;
  contactId: number | null;
  nombre: string;
  pipelineName: string | null;
  sede: string | null; // null = entrada general (ej: ARS_WHATSAPP), le sirve a cualquier sede
  origen: string;
  /** Último mensaje de la familia (suele ser el primero que escribió). null en comentarios de Instagram */
  mensaje: string | null;
  /** true si una persona del equipo ya respondió después del último mensaje de la familia */
  respondido: boolean;
  /** Minutos desde el último mensaje de la familia (o desde que llegó, si no hay registro) */
  minutosEsperando: number;
}

export interface SinClasificarResultado {
  recientes: ChatSinClasificar[];
  antiguos: number; // más viejos que maxDias (probable basura, no se listan)
}

/**
 * Chats que llegaron a "Incoming leads" y nadie aceptó todavía.
 * No aparecen en /leads ni en /talks con lead asignado, por eso van aparte.
 */
export async function getSinClasificar(maxDias = 7): Promise<SinClasificarResultado> {
  const pipelines = await getPipelines();
  const ahora = Math.floor(Date.now() / 1000);
  const recientes: ChatSinClasificar[] = [];
  let antiguos = 0;

  for (let page = 1; page <= 10; page++) {
    const res = await kommoFetch(`/leads/unsorted?limit=250&page=${page}`);
    if (!res.ok || res.status === 204) break;

    const data = await res.json();
    const items = data?._embedded?.unsorted ?? [];

    for (const u of items) {
      const minutosEsperando = Math.round((ahora - u.created_at) / 60);
      if (minutosEsperando > maxDias * 1440) {
        antiguos++;
        continue;
      }

      const contacto = u._embedded?.contacts?.[0];
      const pipelineName = pipelines.get(u.pipeline_id) ?? null;
      const sede = detectarSede(pipelineName);

      // Kommo manda un ID numérico en vez del texto para comentarios de Instagram
      const texto = typeof u.metadata?.last_message_text === "string" ? u.metadata.last_message_text.trim() : "";
      const mensaje = texto && !/^\d+$/.test(texto) ? texto : null;

      recientes.push({
        uid: u.uid,
        leadId: u._embedded?.leads?.[0]?.id ?? null,
        contactId: contacto?.id ?? null,
        nombre: u.metadata?.client?.name ?? contacto?.name ?? u.metadata?.from ?? "Sin nombre",
        pipelineName,
        // detectarSede devuelve el nombre del pipeline si no reconoce sede
        sede: sede && sede !== pipelineName ? sede : null,
        origen: u.metadata?.source_name ?? u.source_name ?? u.category ?? "chat",
        mensaje,
        respondido: false,
        minutosEsperando,
      });
    }

    if (items.length < 250) break;
  }

  // Cruzar con mensajes de chat: ¿alguien del equipo respondió después del último mensaje de la familia?
  const desde = ahora - maxDias * 86400;
  const [entrantes, salientes] = await Promise.all([
    ultimoMensajePorLead("incoming_chat_message", desde, false),
    ultimoMensajePorLead("outgoing_chat_message", desde, true),
  ]);
  for (const chat of recientes) {
    if (!chat.leadId) continue;
    const ultimoEntrante = entrantes.get(chat.leadId);
    const ultimaRespuesta = salientes.get(chat.leadId);
    if (ultimoEntrante) chat.minutosEsperando = Math.round((ahora - ultimoEntrante) / 60);
    chat.respondido = Boolean(ultimaRespuesta && (!ultimoEntrante || ultimaRespuesta >= ultimoEntrante));
  }

  // Sin respuesta primero y, dentro de cada grupo, los más nuevos (todavía se pueden atender a tiempo)
  recientes.sort((a, b) => Number(a.respondido) - Number(b.respondido) || a.minutosEsperando - b.minutosEsperando);
  return { recientes, antiguos };
}

/**
 * Último mensaje de chat por lead desde `desde` (unix). Con soloHumanos, ignora
 * los mensajes automáticos (created_by = 0: Salesbot / sistema).
 */
async function ultimoMensajePorLead(tipo: string, desde: number, soloHumanos: boolean): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  for (let page = 1; page <= 20; page++) {
    const res = await kommoFetch(`/events?filter[type]=${tipo}&filter[created_at][from]=${desde}&limit=100&page=${page}`);
    if (!res.ok || res.status === 204) break;
    const data = await res.json();
    const eventos = data?._embedded?.events ?? [];
    for (const ev of eventos) {
      if (ev.entity_type !== "lead") continue;
      if (soloHumanos && !ev.created_by) continue;
      if (ev.created_at > (map.get(ev.entity_id) ?? 0)) map.set(ev.entity_id, ev.created_at);
    }
    if (eventos.length < 100) break;
  }
  return map;
}

// ============================================================
// SEGUIMIENTO: LEADS ESTANCADOS POR ETAPA
// ============================================================

// Días máximos sin movimiento por etapa (nombre en minúsculas, "contains").
// Etapas terminales (matrícula, no le interesa, no califica...) no se revisan.
const REGLAS_ESTANCADO: { etapa: string; dias: number }[] = [
  { etapa: "calificación", dias: 1 },
  { etapa: "información enviada", dias: 2 },
  { etapa: "en negociación", dias: 3 },
  { etapa: "visita", dias: 3 },
  { etapa: "reconexión enviada", dias: 3 },
  { etapa: "recontacto", dias: 3 },
  { etapa: "esperando clasificación", dias: 2 },
  { etapa: "con diagnostico", dias: 2 },
  { etapa: "lo está pensando", dias: 5 },
  { etapa: "remarketing pendiente", dias: 7 },
];

export interface LeadEstancado {
  leadId: number;
  nombre: string;
  pipelineName: string;
  etapa: string;
  diasSinMovimiento: number;
  limiteDias: number;
  url: string;
}

export interface EstancadosPorSede {
  sede: string;
  leads: LeadEstancado[];
}

/**
 * Revisa los pipelines activos de cada sede y devuelve los leads que
 * llevan más días sin movimiento que lo permitido para su etapa.
 * "Sin movimiento" = updated_at del lead (cambio de etapa, nota, campo).
 */
export async function getLeadsEstancados(): Promise<EstancadosPorSede[]> {
  const { subdomain } = getKommoOptions();
  const res = await kommoFetch("/leads/pipelines");
  if (!res.ok || res.status === 204) return [];
  const data = await res.json();

  const pipelines = (data?._embedded?.pipelines ?? []).filter((p: { is_archive: boolean; name: string }) => {
    const sede = detectarSede(p.name);
    return !p.is_archive && sede && sede !== p.name;
  });

  const ahora = Math.floor(Date.now() / 1000);
  const porSede = new Map<string, LeadEstancado[]>();
  const contactIds: number[] = [];
  const contactoDeLead = new Map<number, number>();

  for (const pipeline of pipelines) {
    const sede = detectarSede(pipeline.name)!;
    const etapas = new Map<number, string>();
    for (const s of pipeline._embedded?.statuses ?? []) etapas.set(s.id, s.name);

    for (let page = 1; page <= 10; page++) {
      const r = await kommoFetch(`/leads?filter[pipeline_id]=${pipeline.id}&with=contacts&limit=250&page=${page}`);
      if (!r.ok || r.status === 204) break;
      const d = await r.json();
      const leads = d?._embedded?.leads ?? [];

      for (const lead of leads) {
        const etapa = etapas.get(lead.status_id) ?? "";
        const regla = REGLAS_ESTANCADO.find((x) => etapa.toLowerCase().includes(x.etapa));
        if (!regla) continue;

        const dias = (ahora - lead.updated_at) / 86400;
        if (dias < regla.dias) continue;

        const contactId = lead._embedded?.contacts?.[0]?.id;
        if (contactId) {
          contactIds.push(contactId);
          contactoDeLead.set(lead.id, contactId);
        }

        if (!porSede.has(sede)) porSede.set(sede, []);
        porSede.get(sede)!.push({
          leadId: lead.id,
          nombre: lead.name || `Lead #${lead.id}`,
          pipelineName: pipeline.name,
          etapa,
          diasSinMovimiento: Math.floor(dias),
          limiteDias: regla.dias,
          url: `https://${subdomain}.kommo.com/leads/detail/${lead.id}`,
        });
      }

      if (leads.length < 250) break;
    }
  }

  // Preferir el nombre del contacto (el del lead suele ser "Lead #123")
  const nombres = await getContactNames([...new Set(contactIds)]);
  const resultado: EstancadosPorSede[] = [];
  for (const [sede, leads] of porSede) {
    for (const l of leads) {
      const cid = contactoDeLead.get(l.leadId);
      const nombreContacto = cid ? nombres.get(cid) : undefined;
      if (nombreContacto) l.nombre = nombreContacto;
    }
    // Los recién vencidos primero: son los que todavía se pueden recuperar
    leads.sort((a, b) => a.diasSinMovimiento - b.diasSinMovimiento);
    resultado.push({ sede, leads });
  }

  return resultado;
}

// ============================================================
// REPORTE SEMANAL DE ADMISIÓN
// ============================================================

// ID fijo de Kommo para la etapa "Logrado con éxito" (ganado) en todos los pipelines
const STATUS_GANADO = 142;

export interface EtapaConteo {
  etapaId: number;
  etapaName: string;
  cantidad: number;
}

export interface ReporteSede {
  pipelineName: string;
  totalLeads: number;
  etapas: EtapaConteo[];
  visitas: number;
  visitasEtapas: string[];
  visitasAproximado: boolean;
  matriculas: number;
}

export interface CambioEtapa {
  leadId: number;
  pipelineId: number;
  statusId: number;
}

/**
 * Obtiene el detalle de pipelines con sus etapas (status) para poder mapear.
 */
async function getPipelinesConEtapas(): Promise<Map<number, { name: string; statuses: Map<number, string> }>> {
  const res = await kommoFetch("/leads/pipelines");
  const map = new Map<number, { name: string; statuses: Map<number, string> }>();
  if (!res.ok || res.status === 204) return map;

  const data = await res.json();
  const pipelines = data?._embedded?.pipelines ?? [];

  for (const pipeline of pipelines) {
    const statuses = new Map<number, string>();
    const embeddedStatuses = pipeline._embedded?.statuses ?? [];
    for (const status of embeddedStatuses) {
      statuses.set(status.id, status.name);
    }
    map.set(pipeline.id, { name: pipeline.name ?? "", statuses });
  }

  return map;
}

/**
 * Obtiene los cambios de etapa de leads ocurridos en un rango (unix, segundos).
 * Kommo responde 204 cuando no hay resultados.
 */
export async function obtenerCambiosDeEtapa(desde: number, hasta: number): Promise<CambioEtapa[]> {
  const cambios: CambioEtapa[] = [];
  let page = 1;

  while (page <= 50) {
    const res = await kommoFetch(
      `/events?filter[type]=lead_status_changed&filter[created_at][from]=${desde}&filter[created_at][to]=${hasta}&limit=100&page=${page}`
    );
    if (!res.ok || res.status === 204) break;

    const data = await res.json();
    const eventos = data?._embedded?.events ?? [];

    for (const ev of eventos) {
      const status = ev.value_after?.[0]?.lead_status;
      if (!status) continue;
      cambios.push({ leadId: ev.entity_id, pipelineId: status.pipeline_id, statusId: status.id });
    }

    if (eventos.length < 100) break;
    page++;
  }

  return cambios;
}

/**
 * Arma el reporte de un pipeline (buscado por nombre):
 * - etapas: foto actual de leads por etapa (referencia)
 * - visitas / matrículas: leads distintos que ENTRARON a esas etapas según `cambios`
 */
export async function contarLeadsPorPipeline(
  pipelineNombre: string,
  cambios: CambioEtapa[]
): Promise<ReporteSede | null> {
  const pipelines = await getPipelinesConEtapas();

  // Buscar el pipeline por nombre (case insensitive, contains)
  let pipelineId: number | null = null;
  let pipelineInfo: { name: string; statuses: Map<number, string> } | null = null;

  for (const [id, info] of pipelines) {
    if (info.name.toLowerCase().includes(pipelineNombre.toLowerCase())) {
      pipelineId = id;
      pipelineInfo = info;
      break;
    }
  }

  if (!pipelineId || !pipelineInfo) return null;

  // Foto actual: leads por etapa
  const leadsPorEtapa = new Map<number, number>();
  let totalLeads = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) {
    const res = await kommoFetch(`/leads?filter[pipeline_id]=${pipelineId}&limit=250&page=${page}`);
    if (!res.ok || res.status === 204) break;

    const data = await res.json();
    const leads = data?._embedded?.leads ?? [];

    for (const lead of leads) {
      const statusId = lead.status_id;
      leadsPorEtapa.set(statusId, (leadsPorEtapa.get(statusId) ?? 0) + 1);
      totalLeads++;
    }

    hasMore = leads.length === 250;
    page++;
  }

  const etapas: EtapaConteo[] = [];
  for (const [statusId, cantidad] of leadsPorEtapa) {
    const etapaName = pipelineInfo.statuses.get(statusId) ?? `Etapa ${statusId}`;
    etapas.push({ etapaId: statusId, etapaName, cantidad });
  }

  // Etapas de visita: preferir las de visita realizada; si no hay, cualquier etapa con "visita"
  const todas = [...pipelineInfo.statuses.entries()];
  const deVisita = todas.filter(([, n]) => n.toLowerCase().includes("visita"));
  const realizadas = deVisita.filter(([, n]) => /realiz|atend|asisti|hecha/.test(n.toLowerCase()));
  const etapasVisita = realizadas.length > 0 ? realizadas : deVisita;
  const idsVisita = new Set(etapasVisita.map(([id]) => id));

  // Matrícula: etapa ganada de Kommo + cualquier etapa con "matr"
  const idsMatricula = new Set<number>([STATUS_GANADO]);
  for (const [id, n] of todas) {
    if (n.toLowerCase().includes("matr")) idsMatricula.add(id);
  }

  const leadsVisita = new Set<number>();
  const leadsMatricula = new Set<number>();
  for (const c of cambios) {
    if (c.pipelineId !== pipelineId) continue;
    if (idsVisita.has(c.statusId)) leadsVisita.add(c.leadId);
    if (idsMatricula.has(c.statusId)) leadsMatricula.add(c.leadId);
  }

  return {
    pipelineName: pipelineInfo.name,
    totalLeads,
    etapas,
    visitas: leadsVisita.size,
    visitasEtapas: etapasVisita.map(([, n]) => n),
    visitasAproximado: realizadas.length === 0,
    matriculas: leadsMatricula.size,
  };
}
