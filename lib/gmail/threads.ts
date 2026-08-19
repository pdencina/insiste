/**
 * Lectura de hilos de Gmail y detección de mensajes nuevos de la contraparte.
 */

import type { gmail_v1 } from "googleapis";
import { withRetry } from "./client";
import { parseHeaders, extractEmail, type ParsedHeaders } from "./headers";

export interface ThreadMessage {
  id: string;
  threadId: string;
  headers: ParsedHeaders;
  snippet: string;
  hasAttachments: boolean;
  internalDate: number; // timestamp ms
}

export interface ThreadInfo {
  id: string;
  messages: ThreadMessage[];
  totalMessages: number;
}

/**
 * Obtiene un hilo completo con metadata de cada mensaje.
 */
export async function getThread(
  gmail: gmail_v1.Gmail,
  threadId: string
): Promise<ThreadInfo> {
  const response = await withRetry(() =>
    gmail.users.threads.get({
      userId: "me",
      id: threadId,
      format: "metadata",
      metadataHeaders: [
        "From",
        "To",
        "Cc",
        "Subject",
        "Date",
        "Message-ID",
        "Message-Id",
        "In-Reply-To",
        "References",
        "Content-Type",
        "Auto-Submitted",
        "Precedence",
        "List-Id",
        "List-Unsubscribe",
        "X-Autoreply",
        "X-Autorespond",
      ],
    })
  );

  const thread = response.data;
  const messages: ThreadMessage[] = (thread.messages ?? []).map((msg) => {
    const headers = parseHeaders(
      (msg.payload?.headers ?? []) as { name: string; value: string }[]
    );

    const hasAttachments =
      msg.payload?.parts?.some(
        (part) =>
          part.filename && part.filename.length > 0 && part.body?.attachmentId
      ) ?? false;

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      headers,
      snippet: msg.snippet ?? "",
      hasAttachments,
      internalDate: parseInt(msg.internalDate ?? "0", 10),
    };
  });

  return {
    id: thread.id!,
    messages,
    totalMessages: messages.length,
  };
}

/**
 * Detecta mensajes nuevos de la contraparte en un hilo.
 * Compara contra la cantidad de mensajes que ya teníamos vistos.
 *
 * @param thread - Info del hilo obtenida de Gmail
 * @param mensajesVistos - Cantidad de mensajes que ya habíamos procesado
 * @param cuentaEmail - Email de la cuenta propia para filtrar
 * @returns Solo los mensajes nuevos que NO son del usuario
 */
export function detectNewCounterpartyMessages(
  thread: ThreadInfo,
  mensajesVistos: number,
  cuentaEmail: string
): ThreadMessage[] {
  if (thread.totalMessages <= mensajesVistos) {
    return [];
  }

  // Los mensajes nuevos son los que exceden el conteo anterior
  const nuevos = thread.messages.slice(mensajesVistos);
  const emailNormalizado = cuentaEmail.toLowerCase();

  // Filtrar solo los que NO son del usuario
  return nuevos.filter((msg) => {
    const from = msg.headers.from;
    if (!from) return true; // Si no tiene From, asumir contraparte
    const emailRemitente = extractEmail(from);
    return emailRemitente !== emailNormalizado;
  });
}

/**
 * Detecta si el usuario envió manualmente un mensaje en el hilo
 * (uno que el agente no conoce).
 */
export function detectManualUserMessage(
  thread: ThreadInfo,
  mensajesVistos: number,
  cuentaEmail: string
): ThreadMessage | null {
  if (thread.totalMessages <= mensajesVistos) {
    return null;
  }

  const nuevos = thread.messages.slice(mensajesVistos);
  const emailNormalizado = cuentaEmail.toLowerCase();

  // Buscar mensajes del usuario
  const propios = nuevos.filter((msg) => {
    const from = msg.headers.from;
    if (!from) return false;
    return extractEmail(from) === emailNormalizado;
  });

  return propios.length > 0 ? propios[propios.length - 1] : null;
}

/**
 * Obtiene el cuerpo de texto plano de un mensaje específico.
 * Se usa para pasar al clasificador (solo un extracto).
 */
export async function getMessageBody(
  gmail: gmail_v1.Gmail,
  messageId: string,
  maxLength: number = 1500
): Promise<string> {
  const response = await withRetry(() =>
    gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    })
  );

  const msg = response.data;
  let body = "";

  // Buscar parte text/plain
  const parts = msg.payload?.parts ?? [];
  const textPart =
    parts.find((p) => p.mimeType === "text/plain") ?? msg.payload;

  if (textPart?.body?.data) {
    body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
  }

  // Truncar al límite
  if (body.length > maxLength) {
    body = body.substring(0, maxLength) + "\n[...truncado]";
  }

  return body;
}

/**
 * Lista los hilos que tienen una etiqueta específica.
 */
export async function listThreadsByLabel(
  gmail: gmail_v1.Gmail,
  labelId: string,
  maxResults: number = 50
): Promise<string[]> {
  const response = await withRetry(() =>
    gmail.users.threads.list({
      userId: "me",
      labelIds: [labelId],
      maxResults,
    })
  );

  return (response.data.threads ?? []).map((t) => t.id!);
}
