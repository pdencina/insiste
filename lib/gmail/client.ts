import { google, type gmail_v1 } from "googleapis";
import { createServiceClient } from "@/lib/supabase/client";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];

// Configuración de reintentos
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
}

/**
 * Crea un cliente OAuth2 de Google con las credenciales de la app.
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Genera la URL de autorización para conectar la cuenta de Gmail.
 */
export function getAuthUrl(): string {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

/**
 * Intercambia el código de autorización por tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Obtiene un cliente Gmail autenticado para una cuenta específica.
 * Maneja el refresh automático del access token cuando expira.
 */
export async function getGmailClient(cuentaId: string): Promise<gmail_v1.Gmail> {
  const supabase = createServiceClient();

  const { data: cuenta, error } = await supabase
    .from("cuentas")
    .select("*")
    .eq("id", cuentaId)
    .single();

  if (error || !cuenta) {
    throw new Error(`Cuenta no encontrada: ${cuentaId}`);
  }

  if (cuenta.estado !== "activa") {
    throw new Error(`Cuenta ${cuentaId} no está activa (estado: ${cuenta.estado})`);
  }

  const oauth2Client = createOAuth2Client();

  // Descifrar el refresh token
  // Supabase devuelve bytea como base64 del contenido binario.
  // El contenido binario es el refresh token en UTF-8.
  let refreshToken: string;
  try {
    refreshToken = Buffer.from(cuenta.refresh_token_cifrado, "base64").toString("utf-8");
  } catch {
    // Fallback: intentar leer como string directo
    refreshToken = String(cuenta.refresh_token_cifrado);
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Verificar si el access token está expirado
  const ahora = new Date();
  const expira = cuenta.access_expira_en ? new Date(cuenta.access_expira_en) : null;
  const necesitaRefresh = !cuenta.access_token || !expira || ahora >= expira;

  if (necesitaRefresh) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const nuevoToken = credentials.access_token;
      const nuevaExpiracion = credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null;

      // Actualizar en base de datos
      await supabase
        .from("cuentas")
        .update({
          access_token: nuevoToken,
          access_expira_en: nuevaExpiracion,
        })
        .eq("id", cuentaId);

      oauth2Client.setCredentials(credentials);
    } catch (err) {
      // Token revocado o inválido — marcar cuenta como error
      await supabase
        .from("cuentas")
        .update({ estado: "revocada" })
        .eq("id", cuentaId);

      // Pausar todos los seguimientos de esta cuenta
      await supabase
        .from("seguimientos")
        .update({ estado: "pausado", motivo_pausa: "Token revocado" })
        .eq("cuenta_id", cuentaId)
        .eq("estado", "activo");

      throw new Error(`Token revocado para cuenta ${cuentaId}: ${err}`);
    }
  } else {
    oauth2Client.setCredentials({ access_token: cuenta.access_token });
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Ejecuta una llamada a la API de Gmail con retroceso exponencial ante 429 y 5xx.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = MAX_RETRIES, baseDelay = BASE_DELAY_MS } = options;

  for (let intento = 0; intento <= maxRetries; intento++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const esReintentable = status === 429 || (status !== null && status >= 500);

      if (!esReintentable || intento === maxRetries) {
        throw err;
      }

      // Retroceso exponencial con jitter
      const delay = baseDelay * Math.pow(2, intento) + Math.random() * 500;
      await sleep(delay);
    }
  }

  // Inalcanzable, pero TypeScript lo necesita
  throw new Error("Reintentos agotados");
}

function getErrorStatus(err: unknown): number | null {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "number"
  ) {
    return (err as { code: number }).code;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { SCOPES };
