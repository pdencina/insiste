/**
 * Tipos de la base de datos generados a partir del esquema SQL.
 * En producción se generarían con `supabase gen types typescript`.
 * Por ahora definimos los tipos manualmente basados en 0001_init.sql.
 */

export type EstadoCuenta = "activa" | "revocada" | "error";
export type EstadoSeguimiento = "activo" | "pausado" | "cerrado" | "agotado";
export type MotivoCierre = "entregado" | "rechazo" | "rebote" | "manual" | "agotado";
export type DireccionMensaje = "propio" | "contraparte";
export type ClaseRespuesta =
  | "entregado"
  | "promesa"
  | "pregunta"
  | "rechazo"
  | "irrelevante"
  | "automatico"
  | "rebote";
export type TipoEnvio = "recordatorio" | "acuse" | "borrador";
export type EstadoEnvio = "enviado" | "fallido" | "borrador";

export interface Cuenta {
  id: string;
  user_id: string;
  email: string;
  refresh_token_cifrado: string; // bytea como base64
  access_token: string | null;
  access_expira_en: string | null;
  estado: EstadoCuenta;
  envio_habilitado: boolean;
  creado_en: string;
}

export interface Reglas {
  id: string;
  user_id: string;
  cadencia_dias: number[];
  hora_inicio: string; // time como "08:00"
  hora_fin: string;
  solo_dias_habiles: boolean;
  solo_borradores: boolean;
  acuse_automatico: boolean;
  tope_semanal_destinatario: number;
  umbral_confianza: number;
  actualizado_en: string;
}

export interface Seguimiento {
  id: string;
  user_id: string;
  cuenta_id: string;
  thread_id: string;
  asunto: string;
  destinatarios: string[];
  objetivo: string | null;
  estado: EstadoSeguimiento;
  motivo_cierre: MotivoCierre | null;
  motivo_pausa: string | null;
  intentos: number;
  ultimo_envio_propio: string;
  ultimo_message_id: string;
  referencias: string | null;
  proximo_intento: string | null;
  mensajes_vistos: number;
  creado_en: string;
}

export interface MensajeHilo {
  id: string;
  user_id: string;
  seguimiento_id: string;
  gmail_message_id: string;
  rfc_message_id: string | null;
  direccion: DireccionMensaje;
  remitente: string | null;
  extracto: string | null;
  tiene_adjuntos: boolean;
  recibido_en: string;
}

export interface Clasificacion {
  id: string;
  user_id: string;
  seguimiento_id: string;
  mensaje_id: string;
  clase: ClaseRespuesta;
  confianza: number | null;
  razon: string | null;
  fecha_prometida: string | null;
  por_headers: boolean;
  modelo: string | null;
  creado_en: string;
}

export interface Envio {
  id: string;
  user_id: string;
  seguimiento_id: string;
  tipo: TipoEnvio;
  intento: number | null;
  escalon_tono: number | null;
  cuerpo: string;
  gmail_message_id: string | null;
  estado: EstadoEnvio;
  error: string | null;
  clave_idempotencia: string;
  creado_en: string;
}

export interface Feriado {
  fecha: string;
  nombre: string;
  irrenunciable: boolean;
}

export interface Evento {
  id: string;
  user_id: string;
  seguimiento_id: string | null;
  accion: string;
  detalle: Record<string, unknown>;
  creado_en: string;
}

// Tipo raíz para el cliente tipado de Supabase
export interface Database {
  public: {
    Tables: {
      cuentas: { Row: Cuenta; Insert: Partial<Cuenta> & Pick<Cuenta, "user_id" | "email" | "refresh_token_cifrado">; Update: Partial<Cuenta> };
      reglas: { Row: Reglas; Insert: Partial<Reglas> & Pick<Reglas, "user_id">; Update: Partial<Reglas> };
      seguimientos: { Row: Seguimiento; Insert: Partial<Seguimiento> & Pick<Seguimiento, "user_id" | "cuenta_id" | "thread_id" | "asunto" | "destinatarios" | "ultimo_envio_propio" | "ultimo_message_id">; Update: Partial<Seguimiento> };
      mensajes_hilo: { Row: MensajeHilo; Insert: Partial<MensajeHilo> & Pick<MensajeHilo, "user_id" | "seguimiento_id" | "gmail_message_id" | "direccion" | "recibido_en">; Update: Partial<MensajeHilo> };
      clasificaciones: { Row: Clasificacion; Insert: Partial<Clasificacion> & Pick<Clasificacion, "user_id" | "seguimiento_id" | "mensaje_id" | "clase">; Update: Partial<Clasificacion> };
      envios: { Row: Envio; Insert: Partial<Envio> & Pick<Envio, "user_id" | "seguimiento_id" | "tipo" | "cuerpo" | "clave_idempotencia">; Update: Partial<Envio> };
      feriados: { Row: Feriado; Insert: Feriado; Update: Partial<Feriado> };
      eventos: { Row: Evento; Insert: Partial<Evento> & Pick<Evento, "user_id" | "accion">; Update: never };
    };
  };
}
