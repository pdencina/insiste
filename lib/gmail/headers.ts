/**
 * Parseo de headers de Gmail y detección de mensajes automáticos/rebotes.
 *
 * Esta lógica se ejecuta ANTES del LLM. Si un mensaje es detectable como
 * automático o rebote por sus headers, no se gasta un call a Claude.
 */

import type { ClaseRespuesta } from "@/lib/supabase/types";

export interface ParsedHeaders {
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  subject: string | null;
  date: string | null;
  contentType: string | null;
  autoSubmitted: string | null;
  precedence: string | null;
  listId: string | null;
  listUnsubscribe: string | null;
  xAutoreply: string | null;
  xAutorespond: string | null;
}

export interface HeaderClassification {
  clase: ClaseRespuesta | null;
  razon: string | null;
}

type GmailHeader = { name: string; value: string };

/**
 * Extrae headers relevantes de un array de headers de Gmail API.
 */
export function parseHeaders(headers: GmailHeader[]): ParsedHeaders {
  const get = (name: string): string | null => {
    const h = headers.find(
      (h) => h.name.toLowerCase() === name.toLowerCase()
    );
    return h?.value ?? null;
  };

  return {
    messageId: get("Message-ID") || get("Message-Id"),
    inReplyTo: get("In-Reply-To"),
    references: get("References"),
    from: get("From"),
    to: get("To"),
    cc: get("Cc") || get("CC"),
    subject: get("Subject"),
    date: get("Date"),
    contentType: get("Content-Type"),
    autoSubmitted: get("Auto-Submitted"),
    precedence: get("Precedence"),
    listId: get("List-Id"),
    listUnsubscribe: get("List-Unsubscribe"),
    xAutoreply: get("X-Autoreply"),
    xAutorespond: get("X-Autorespond"),
  };
}

/**
 * Clasifica un mensaje como automático o rebote basándose exclusivamente
 * en los headers, sin llamar al LLM.
 *
 * Retorna null en `clase` si no se puede determinar por headers.
 */
export function classifyByHeaders(parsed: ParsedHeaders): HeaderClassification {
  // 1. Rebote (delivery failure)
  if (
    parsed.contentType &&
    parsed.contentType.includes("multipart/report") &&
    parsed.contentType.includes("delivery-status")
  ) {
    return { clase: "rebote", razon: "Content-Type indica delivery-status report" };
  }

  // 2. Remitente de sistema
  const from = parsed.from?.toLowerCase() ?? "";
  if (from.includes("mailer-daemon@") || from.includes("postmaster@")) {
    return { clase: "rebote", razon: `Remitente de sistema: ${parsed.from}` };
  }

  // 3. Auto-Submitted (RFC 3834)
  if (parsed.autoSubmitted && parsed.autoSubmitted.toLowerCase() !== "no") {
    return {
      clase: "automatico",
      razon: `Auto-Submitted: ${parsed.autoSubmitted}`,
    };
  }

  // 4. Headers de autorespuesta
  if (parsed.xAutoreply) {
    return { clase: "automatico", razon: "X-Autoreply presente" };
  }
  if (parsed.xAutorespond) {
    return { clase: "automatico", razon: "X-Autorespond presente" };
  }

  // 5. Precedence
  const precedence = parsed.precedence?.toLowerCase() ?? "";
  if (["bulk", "auto_reply", "junk"].includes(precedence)) {
    return {
      clase: "automatico",
      razon: `Precedence: ${parsed.precedence}`,
    };
  }

  // 6. Lista de correo (no es una respuesta personal)
  if (parsed.listId || parsed.listUnsubscribe) {
    return {
      clase: "automatico",
      razon: "Mensaje de lista de correo (List-Id o List-Unsubscribe presente)",
    };
  }

  // No se puede determinar por headers
  return { clase: null, razon: null };
}

/**
 * Extrae el email limpio de un header From (sin el nombre).
 * "Pablo Encina <pablo@example.com>" → "pablo@example.com"
 */
export function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

/**
 * Construye la cadena de References para un nuevo mensaje en el hilo.
 * Acumula los Message-IDs anteriores + el del mensaje al que se responde.
 */
export function buildReferences(
  existingReferences: string | null,
  replyToMessageId: string
): string {
  if (!existingReferences) {
    return replyToMessageId;
  }
  // Evitar duplicados
  if (existingReferences.includes(replyToMessageId)) {
    return existingReferences;
  }
  return `${existingReferences} ${replyToMessageId}`;
}

/**
 * Asegura que el asunto tenga el prefijo "Re: " sin duplicarlo.
 */
export function ensureRePrefix(subject: string): string {
  // Remover prefijos Re:/RE:/re: existentes (pueden estar anidados)
  const cleaned = subject.replace(/^(Re:\s*)+/i, "").trim();
  return `Re: ${cleaned}`;
}
