/**
 * Motor de cadencia — Calcula cuándo toca el próximo recordatorio.
 *
 * Reglas:
 * - Cadencia por defecto: días hábiles 1, 3, 7, 12 desde el último envío propio
 * - Días hábiles = lunes a viernes, excluyendo feriados chilenos
 * - Hora de anclaje: 08:30 Santiago
 * - Si el resultado ya pasó, se dispara en el próximo ciclo dentro de ventana hábil
 * - Timezone: America/Santiago para toda la lógica, almacenamiento en UTC
 */

import { createServiceClient } from "@/lib/supabase/client";
import type { Reglas, Feriado } from "@/lib/supabase/types";

const TIMEZONE = "America/Santiago";
const HORA_ANCLAJE = { hora: 8, minuto: 30 };

// Cache de feriados por año
const feriadosCache = new Map<number, Set<string>>();

/**
 * Calcula la fecha y hora del próximo intento para un seguimiento.
 *
 * @param ultimoEnvioPropio - Fecha del último envío propio (UTC)
 * @param intento - Número de intento actual (0-indexed: 0 = primer recordatorio)
 * @param reglas - Configuración del usuario
 * @returns Fecha UTC del próximo intento, o null si se agotó la cadencia
 */
export async function proximoIntento(
  ultimoEnvioPropio: Date,
  intento: number,
  reglas: Reglas
): Promise<Date | null> {
  const cadencia = reglas.cadencia_dias;

  // Si ya se agotó la cadencia, no hay próximo intento
  if (intento >= cadencia.length) {
    return null;
  }

  const diasHabilesASumar = cadencia[intento];

  // Calcular fecha sumando días hábiles desde el último envío propio
  const fechaObjetivo = await sumarDiasHabiles(
    ultimoEnvioPropio,
    diasHabilesASumar,
    reglas.solo_dias_habiles
  );

  // Anclar a la hora de envío (08:30 Santiago)
  const fechaAnclada = anclarAHora(fechaObjetivo);

  // Si ya pasó, buscar el siguiente inicio de ventana hábil
  const ahora = new Date();
  if (fechaAnclada <= ahora) {
    return await proximaVentanaHabil(ahora, reglas);
  }

  return fechaAnclada;
}

/**
 * Reprograma un seguimiento tras una promesa con fecha.
 * Espera fecha_prometida + 2 días hábiles adicionales como gracia.
 */
export async function reprogramarPorPromesa(
  fechaPrometida: Date,
  reglas: Reglas
): Promise<Date> {
  const fechaConGracia = await sumarDiasHabiles(fechaPrometida, 2, reglas.solo_dias_habiles);
  return anclarAHora(fechaConGracia);
}

/**
 * Suma N días hábiles a una fecha, saltando sábados, domingos y feriados.
 */
export async function sumarDiasHabiles(
  desde: Date,
  diasHabiles: number,
  soloHabiles: boolean
): Promise<Date> {
  if (!soloHabiles) {
    // Si no se filtran días hábiles, sumar días calendario
    const resultado = new Date(desde);
    resultado.setDate(resultado.getDate() + diasHabiles);
    return resultado;
  }

  const feriados = await obtenerFeriados(desde.getFullYear());
  let fecha = new Date(desde);
  let diasSumados = 0;

  while (diasSumados < diasHabiles) {
    fecha.setDate(fecha.getDate() + 1);

    // Verificar si necesitamos feriados del año siguiente
    if (fecha.getFullYear() !== desde.getFullYear()) {
      const feriadosNuevoAnio = await obtenerFeriados(fecha.getFullYear());
      feriadosNuevoAnio.forEach((f) => feriados.add(f));
    }

    if (esDiaHabil(fecha, feriados)) {
      diasSumados++;
    }
  }

  return fecha;
}

/**
 * Verifica si un momento dado está dentro del horario hábil.
 * Usado por las guardas AL MOMENTO del envío (no solo al programar).
 */
export function esHorarioHabil(fecha: Date, reglas: Reglas): boolean {
  // Convertir a hora de Santiago
  const enSantiago = toSantiago(fecha);
  const hora = enSantiago.getHours();
  const minuto = enSantiago.getMinutes();

  // Parsear hora_inicio y hora_fin
  const [inicioH, inicioM] = reglas.hora_inicio.split(":").map(Number);
  const [finH, finM] = reglas.hora_fin.split(":").map(Number);

  const minutosActual = hora * 60 + minuto;
  const minutosInicio = inicioH * 60 + inicioM;
  const minutosFin = finH * 60 + finM;

  if (minutosActual < minutosInicio || minutosActual >= minutosFin) {
    return false;
  }

  // Verificar día de la semana (solo lunes a viernes si aplica)
  if (reglas.solo_dias_habiles) {
    const dia = enSantiago.getDay(); // 0=dom, 6=sab
    if (dia === 0 || dia === 6) {
      return false;
    }

    // Verificar feriados (sync — usa cache)
    const fechaStr = formatDate(enSantiago);
    const feriadosAnio = feriadosCache.get(enSantiago.getFullYear());
    if (feriadosAnio?.has(fechaStr)) {
      return false;
    }
  }

  return true;
}

/**
 * Calcula la próxima ventana hábil disponible desde un momento dado.
 */
export async function proximaVentanaHabil(
  desde: Date,
  reglas: Reglas
): Promise<Date> {
  const feriados = await obtenerFeriados(desde.getFullYear());
  let fecha = new Date(desde);

  // Avanzar hasta encontrar un momento hábil
  for (let i = 0; i < 30; i++) {
    // Máximo 30 días de búsqueda
    fecha.setDate(fecha.getDate() + 1);

    if (esDiaHabil(fecha, feriados)) {
      return anclarAHora(fecha);
    }
  }

  // Fallback: si no encuentra en 30 días, usar el día 31
  fecha.setDate(fecha.getDate() + 1);
  return anclarAHora(fecha);
}

/**
 * Verifica si un día es hábil (no fin de semana, no feriado).
 */
function esDiaHabil(fecha: Date, feriados: Set<string>): boolean {
  const enSantiago = toSantiago(fecha);
  const dia = enSantiago.getDay();

  // Fin de semana
  if (dia === 0 || dia === 6) return false;

  // Feriado
  const fechaStr = formatDate(enSantiago);
  if (feriados.has(fechaStr)) return false;

  return true;
}

/**
 * Ancla una fecha a las 08:30 hora de Santiago y devuelve UTC.
 */
function anclarAHora(fecha: Date): Date {
  // Crear la fecha en Santiago a las 08:30
  const enSantiago = toSantiago(fecha);
  const year = enSantiago.getFullYear();
  const month = String(enSantiago.getMonth() + 1).padStart(2, "0");
  const day = String(enSantiago.getDate()).padStart(2, "0");

  // Construir la fecha en timezone de Santiago y convertir a UTC
  const santiagoDt = new Date(
    `${year}-${month}-${day}T${String(HORA_ANCLAJE.hora).padStart(2, "0")}:${String(HORA_ANCLAJE.minuto).padStart(2, "0")}:00`
  );

  // Usar Intl para obtener el offset correcto de Santiago
  const utcDate = santiagoToUtc(year, parseInt(month), parseInt(day), HORA_ANCLAJE.hora, HORA_ANCLAJE.minuto);
  return utcDate;
}

/**
 * Convierte hora de Santiago a UTC considerando DST.
 */
function santiagoToUtc(year: number, month: number, day: number, hora: number, minuto: number): Date {
  // Crear fecha en UTC y ajustar por offset de Santiago
  // Chile: UTC-3 en verano (sept-mar), UTC-4 en invierno (abr-ago)
  // Usar toLocaleString para determinar el offset correcto
  const tentative = new Date(Date.UTC(year, month - 1, day, hora, minuto, 0));

  // Obtener la hora en Santiago de esta fecha UTC tentativa
  const santiagoParts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(tentative);

  const horaEnSantiago = parseInt(
    santiagoParts.find((p) => p.type === "hour")?.value ?? "0"
  );

  // Calcular la diferencia y ajustar
  const diff = horaEnSantiago - hora;
  tentative.setHours(tentative.getHours() - diff);

  return tentative;
}

/**
 * Convierte una fecha a hora de Santiago.
 */
function toSantiago(fecha: Date): Date {
  const str = fecha.toLocaleString("en-US", { timeZone: TIMEZONE });
  return new Date(str);
}

/**
 * Formatea una fecha como YYYY-MM-DD para comparación con feriados.
 */
function formatDate(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Obtiene los feriados chilenos de un año desde la base de datos.
 * Los cachea en memoria para evitar queries repetidas.
 */
async function obtenerFeriados(year: number): Promise<Set<string>> {
  if (feriadosCache.has(year)) {
    return feriadosCache.get(year)!;
  }

  const supabase = createServiceClient();
  const inicioAnio = `${year}-01-01`;
  const finAnio = `${year}-12-31`;

  const { data } = await supabase
    .from("feriados")
    .select("fecha")
    .gte("fecha", inicioAnio)
    .lte("fecha", finAnio);

  const set = new Set<string>(
    (data ?? []).map((f: { fecha: string }) => f.fecha)
  );

  feriadosCache.set(year, set);
  return set;
}

/**
 * Carga los feriados chilenos desde una API pública y los guarda en la BD.
 * Se llama una vez al año o cuando la tabla está vacía para un año.
 */
export async function cargarFeriadosAnuales(year: number): Promise<void> {
  const supabase = createServiceClient();

  // Verificar si ya tenemos feriados de este año
  const { count } = await supabase
    .from("feriados")
    .select("fecha", { count: "exact", head: true })
    .gte("fecha", `${year}-01-01`)
    .lte("fecha", `${year}-12-31`);

  if ((count ?? 0) > 0) return; // Ya cargados

  try {
    // API pública de feriados chilenos
    const response = await fetch(
      `https://apis.digital.gob.cl/fl/feriados/${year}`
    );

    if (!response.ok) {
      console.warn(`No se pudieron cargar feriados para ${year}: ${response.status}`);
      return;
    }

    const feriados: Array<{
      fecha: string;
      nombre: string;
      irrenunciable: boolean;
    }> = await response.json();

    if (feriados.length === 0) return;

    // Insertar en lote
    await supabase.from("feriados").upsert(
      feriados.map((f) => ({
        fecha: f.fecha,
        nombre: f.nombre,
        irrenunciable: f.irrenunciable ?? false,
      }))
    );

    // Limpiar cache
    feriadosCache.delete(year);
  } catch (err) {
    console.warn(`Error cargando feriados de ${year}:`, err);
    // Sin conexión se asume día hábil — preferible enviar un feriado
    // aislado que congelar todos los seguimientos.
  }
}
