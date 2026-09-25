/**
 * Reporte de gestión de admisión — Playgroup y AR School Puente Alto.
 *
 * Lo usan el cron del viernes (borrador en Gmail) y el botón "Reporte" del panel.
 * Todo se calcula desde Kommo para un rango de fechas (hora Chile):
 * - Visitas / matrículas: leads que ENTRARON a esas etapas en el rango
 * - Visitas agendadas próxima semana: tareas tipo "Meeting" con fecha la semana siguiente
 * - Gestión de conversaciones: mensajes de chat entrantes/salientes (persona vs bot)
 * - Contactos por interno: notas del lead que mencionan "interno" / "WhatsApp directo"
 */

import { kommoFetch, obtenerCambiosDeEtapa, contarLeadsPorPipeline, type ReporteSede } from "@/lib/kommo/client";

export const PIPELINES_REPORTE = {
  playgroup: "PLAYGROUP PUENTE ALTO",
  arSchool: "AR SCHOOL PUENTE ALTO",
};

const TIPO_TAREA_REUNION = 2; // "Meeting" en esta cuenta
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface DatosReporte {
  rango: string;
  desde: number;
  hasta: number;
  visitasAtendidas: number;
  visitasAtendidasFuente: "reuniones" | "etapa";
  visitasProximaSemana: number;
  hayReunionesRegistradas: boolean;
  matriculasPlaygroup: number;
  matriculasArSchool: number;
  leadsNuevos: { playgroup: number; arSchool: number };
  leadsRespondidos: number;
  respondieronDeVuelta: number;
  sinRespuestaDeLaFamilia: number;
  familiasSinRespuesta: number;
  contactosInterno: number;
  notasRegistradas: number;
  playgroup: ReporteSede | null;
  arSchool: ReporteSede | null;
}

// ---------- Fechas en hora Chile ----------

/** Unix (segundos) de las 00:00 hora Chile del día "YYYY-MM-DD". */
export function inicioDiaChile(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  // Hora de Chile a las 12:00 UTC de ese día → offset (3 en verano, 4 en invierno)
  const horaChile = Number(
    new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", { timeZone: "America/Santiago", hour: "numeric", hour12: false })
  );
  const offset = 12 - horaChile;
  return Date.UTC(y, m - 1, d, offset) / 1000;
}

/** "YYYY-MM-DD" de hoy en Chile, desplazado `dias`. */
export function fechaChile(dias = 0): string {
  const hoy = new Date(Date.now() + dias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  return hoy; // en-CA → YYYY-MM-DD
}

/** Lunes y viernes de la semana actual (Chile), como "YYYY-MM-DD". */
export function semanaActual(): { desde: string; hasta: string } {
  const hoy = new Date(`${fechaChile()}T12:00:00Z`);
  const diasDesdeLunes = (hoy.getUTCDay() + 6) % 7;
  return { desde: fechaChile(-diasDesdeLunes), hasta: fechaChile(4 - diasDesdeLunes) };
}

function textoRango(desde: string, hasta: string): string {
  const [, m1, d1] = desde.split("-").map(Number);
  const [, m2, d2] = hasta.split("-").map(Number);
  return m1 === m2 ? `${d1} al ${d2} de ${MESES[m2 - 1]}` : `${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]}`;
}

// ---------- Lecturas de Kommo ----------

async function getTodo<T>(path: string, clave: string, maxPaginas = 20, limite = 250): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPaginas; page++) {
    const res = await kommoFetch(`${path}${sep}limit=${limite}&page=${page}`);
    if (!res.ok || res.status === 204) break;
    const data = await res.json();
    const items: T[] = data?._embedded?.[clave] ?? [];
    out.push(...items);
    if (items.length < limite) break;
  }
  return out;
}

async function pipelineIds(): Promise<{ playgroup: number | null; arSchool: number | null }> {
  const res = await kommoFetch("/leads/pipelines");
  const pipes: { id: number; name: string }[] = res.ok ? (await res.json())?._embedded?.pipelines ?? [] : [];
  const buscar = (n: string) => pipes.find((p) => p.name.toLowerCase().includes(n.toLowerCase()))?.id ?? null;
  return { playgroup: buscar(PIPELINES_REPORTE.playgroup), arSchool: buscar(PIPELINES_REPORTE.arSchool) };
}

interface EventoChat { entity_id: number; entity_type: string; created_at: number; created_by: number }

// ---------- Reporte ----------

export async function calcularReporte(desdeFecha: string, hastaFecha: string): Promise<DatosReporte> {
  const desde = inicioDiaChile(desdeFecha);
  const hasta = inicioDiaChile(hastaFecha) + 86400 - 1; // fin del día "hasta"

  const ids = await pipelineIds();
  const idsPipes = [ids.playgroup, ids.arSchool].filter((x): x is number => x !== null);

  // Leads de los dos embudos (para filtrar mensajes, notas y tareas)
  type Lead = { id: number; pipeline_id: number; created_at: number };
  const leads = (await Promise.all(idsPipes.map((id) => getTodo<Lead>(`/leads?filter[pipeline_id]=${id}`, "leads", 10)))).flat();
  const leadsPA = new Set(leads.map((l) => l.id));

  const [cambios, entrantes, salientes, notas, tareas] = await Promise.all([
    obtenerCambiosDeEtapa(desde, hasta),
    // Mensajes hasta AHORA: "sin respuesta de la familia" se evalúa al momento del reporte
    getTodo<EventoChat>(`/events?filter[type]=incoming_chat_message&filter[created_at][from]=${desde}`, "events", 40, 100),
    getTodo<EventoChat>(`/events?filter[type]=outgoing_chat_message&filter[created_at][from]=${desde}`, "events", 40, 100),
    getTodo<{ entity_id: number; note_type: string; created_at: number; params?: { text?: string } }>(
      `/leads/notes?filter[updated_at][from]=${desde}&filter[updated_at][to]=${hasta}`, "notes", 20
    ),
    getTodo<{ entity_id: number; task_type_id: number; complete_till: number; is_completed: boolean; updated_at: number }>(
      `/tasks?filter[entity_type]=leads&filter[task_type][]=${TIPO_TAREA_REUNION}`, "tasks", 10
    ),
  ]);

  const [playgroup, arSchool] = await Promise.all([
    contarLeadsPorPipeline(PIPELINES_REPORTE.playgroup, cambios),
    contarLeadsPorPipeline(PIPELINES_REPORTE.arSchool, cambios),
  ]);

  // --- Gestión de conversaciones (solo leads de los dos embudos) ---
  const porLead = new Map<number, { in: number[]; outHumano: number[]; outTodos: number[] }>();
  const reg = (id: number) => {
    if (!porLead.has(id)) porLead.set(id, { in: [], outHumano: [], outTodos: [] });
    return porLead.get(id)!;
  };
  for (const e of entrantes) if (e.entity_type === "lead" && leadsPA.has(e.entity_id)) reg(e.entity_id).in.push(e.created_at);
  for (const e of salientes) {
    if (e.entity_type !== "lead" || !leadsPA.has(e.entity_id)) continue;
    const r = reg(e.entity_id);
    r.outTodos.push(e.created_at);
    if (e.created_by) r.outHumano.push(e.created_at);
  }

  let leadsRespondidos = 0, respondieronDeVuelta = 0, sinRespuestaDeLaFamilia = 0, familiasSinRespuesta = 0;
  for (const r of porLead.values()) {
    const humanosEnRango = r.outHumano.filter((t) => t >= desde && t <= hasta);
    if (humanosEnRango.length > 0) {
      leadsRespondidos++;
      const primeraRespuesta = Math.min(...humanosEnRango);
      if (r.in.some((t) => t > primeraRespuesta)) respondieronDeVuelta++;
      else sinRespuestaDeLaFamilia++;
    }
    // Familias que escribieron en el rango y su último mensaje quedó sin respuesta de una persona
    const entrantesEnRango = r.in.filter((t) => t >= desde && t <= hasta);
    if (entrantesEnRango.length > 0) {
      const ultimoIn = Math.max(...r.in);
      if (!r.outHumano.some((t) => t > ultimoIn)) familiasSinRespuesta++;
    }
  }

  // --- Notas ---
  const notasPA = notas.filter((n) => leadsPA.has(n.entity_id) && n.note_type === "common" && n.created_at >= desde && n.created_at <= hasta);
  const contactosInterno = notasPA.filter((n) => /interno|whatsapp directo/i.test(n.params?.text ?? "")).length;

  // --- Visitas ---
  const reunionesPA = tareas.filter((t) => leadsPA.has(t.entity_id));
  const reunionesAtendidas = reunionesPA.filter((t) => t.is_completed && t.complete_till >= desde && t.complete_till <= hasta).length;
  const lunesSiguiente = inicioDiaChile(fechaDesde(hastaFecha, diasHastaLunes(hastaFecha)));
  const reunionesProxima = reunionesPA.filter((t) => !t.is_completed && t.complete_till >= lunesSiguiente && t.complete_till < lunesSiguiente + 7 * 86400).length;
  const visitasPorEtapa = (playgroup?.visitas ?? 0) + (arSchool?.visitas ?? 0);

  return {
    rango: textoRango(desdeFecha, hastaFecha),
    desde,
    hasta,
    visitasAtendidas: reunionesPA.length > 0 ? reunionesAtendidas : visitasPorEtapa,
    visitasAtendidasFuente: reunionesPA.length > 0 ? "reuniones" : "etapa",
    visitasProximaSemana: reunionesProxima,
    hayReunionesRegistradas: reunionesPA.length > 0,
    matriculasPlaygroup: playgroup?.matriculas ?? 0,
    matriculasArSchool: arSchool?.matriculas ?? 0,
    leadsNuevos: {
      playgroup: leads.filter((l) => l.pipeline_id === ids.playgroup && l.created_at >= desde && l.created_at <= hasta).length,
      arSchool: leads.filter((l) => l.pipeline_id === ids.arSchool && l.created_at >= desde && l.created_at <= hasta).length,
    },
    leadsRespondidos,
    respondieronDeVuelta,
    sinRespuestaDeLaFamilia,
    familiasSinRespuesta,
    contactosInterno,
    notasRegistradas: notasPA.length,
    playgroup,
    arSchool,
  };
}

function diasHastaLunes(fecha: string): number {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return ((8 - dia) % 7) || 7;
}

function fechaDesde(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Texto del reporte en el formato oficial + detalle de gestión. */
export function textoReporte(r: DatosReporte): string {
  let t = `REPORTE GESTIÓN ADMISIÓN\n\n`;
  t += `Fecha informada: ${r.rango}\n`;
  t += `Visitas atendidas: ${r.visitasAtendidas}\n`;
  t += `Visitas agendadas próxima semana: ${r.hayReunionesRegistradas ? r.visitasProximaSemana : "___ (completar)"}\n`;
  t += `Cierre de matrículas Playgroup: ${r.matriculasPlaygroup}\n`;
  t += `Cierre de matrículas AR school: ${r.matriculasArSchool}\n\n`;

  t += `GESTIÓN DE CONVERSACIONES\n`;
  t += `Leads nuevos: ${r.leadsNuevos.playgroup + r.leadsNuevos.arSchool} (Playgroup ${r.leadsNuevos.playgroup} · AR School ${r.leadsNuevos.arSchool})\n`;
  t += `Leads respondidos: ${r.leadsRespondidos}\n`;
  t += `  · Respondieron de vuelta: ${r.respondieronDeVuelta}\n`;
  t += `  · Sin respuesta de la familia: ${r.sinRespuestaDeLaFamilia}\n`;
  t += `Familias que quedaron sin respuesta: ${r.familiasSinRespuesta}\n`;
  t += `Contactos por WhatsApp interno (notas): ${r.contactosInterno}\n`;
  t += `Notas registradas en Kommo: ${r.notasRegistradas}\n`;
  return t;
}

/** Notas internas sobre cómo se calculó (para revisar antes de enviar; no van al equipo). */
export function notasDeCalculo(r: DatosReporte): string {
  const lineas = [
    `Visitas atendidas: ${r.visitasAtendidasFuente === "reuniones"
      ? "tareas tipo Reunión completadas en el período."
      : "leads que entraron a la etapa VISITA en el período (aprox.: la etapa no distingue agendada de realizada)."}`,
    r.hayReunionesRegistradas
      ? "Visitas próxima semana: tareas tipo Reunión con fecha la semana siguiente."
      : "Visitas próxima semana: no hay visitas registradas como tarea tipo Reunión en Kommo; completar a mano.",
    "Leads respondidos: leads con al menos un mensaje tuyo (no del bot) en el período.",
    "Sin respuesta de la familia: respondiste y la familia no volvió a escribir (hasta hoy).",
    "Familias sin respuesta: escribieron en el período y su último mensaje no tiene respuesta de una persona.",
    "Contactos por interno: notas del lead que mencionan \"interno\" o \"WhatsApp directo\".",
  ];
  return lineas.map((l) => `- ${l}`).join("\n");
}
