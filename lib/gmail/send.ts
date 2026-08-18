/**
 * Envío de mensajes dentro del hilo con headers correctos para threading.
 *
 * Regla no negociable: el correo DEBE verse como parte de la conversación
 * existente, no como un correo nuevo. Para esto:
 * - threadId del hilo en el body
 * - In-Reply-To: Message-ID del último mensaje
 * - References: cadena acumulada completa
 * - Subject: Re: asunto original (sin duplicar prefijo)
 */

import type { gmail_v1 } from "googleapis";
import { withRetry } from "./client";
import { ensureRePrefix, buildReferences } from "./headers";

export interface SendOptions {
  gmail: gmail_v1.Gmail;
  threadId: string;
  to: string[];
  subject: string;
  body: string;
  inReplyTo: string; // Message-ID del mensaje al que respondemos
  references: string | null; // Cadena References acumulada
}

export interface SendResult {
  messageId: string; // Gmail message ID
  rfcMessageId: string | null; // RFC Message-ID del header
  threadId: string;
}

/**
 * Envía un mensaje dentro de un hilo existente.
 */
export async function sendInThread(options: SendOptions): Promise<SendResult> {
  const { gmail, threadId, to, subject, body, inReplyTo, references } = options;

  const reSubject = ensureRePrefix(subject);
  const fullReferences = buildReferences(references, inReplyTo);

  // Construir el mensaje RFC 2822
  const rawMessage = buildRawMessage({
    to: to.join(", "),
    subject: reSubject,
    inReplyTo,
    references: fullReferences,
    body,
  });

  const response = await withRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        threadId,
        raw: rawMessage,
      },
    })
  );

  const sentMessage = response.data;

  return {
    messageId: sentMessage.id!,
    rfcMessageId: null, // Se obtiene después si es necesario
    threadId: sentMessage.threadId!,
  };
}

interface RawMessageParams {
  to: string;
  subject: string;
  inReplyTo: string;
  references: string;
  body: string;
}

/**
 * Construye un mensaje en formato RFC 2822, codificado en base64url
 * para la API de Gmail.
 */
function buildRawMessage(params: RawMessageParams): string {
  const { to, subject, inReplyTo, references, body } = params;

  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${references}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    "", // Línea vacía separa headers de body
    body,
  ];

  const message = lines.join("\r\n");

  // Gmail API requiere base64url encoding
  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
