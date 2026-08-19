/**
 * Creación de borradores dentro del hilo.
 *
 * Se usa cuando:
 * - La clase es "pregunta" y el agente no debe responder solo
 * - El modo "solo borradores" está activo
 */

import type { gmail_v1 } from "googleapis";
import { withRetry } from "./client";
import { ensureRePrefix, buildReferences } from "./headers";

export interface DraftOptions {
  gmail: gmail_v1.Gmail;
  threadId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  inReplyTo: string;
  references: string | null;
}

export interface DraftResult {
  draftId: string;
  messageId: string;
  threadId: string;
}

/**
 * Crea un borrador dentro de un hilo existente.
 */
export async function createDraftInThread(options: DraftOptions): Promise<DraftResult> {
  const { gmail, threadId, to, cc, subject, body, inReplyTo, references } = options;

  const reSubject = ensureRePrefix(subject);
  const fullReferences = buildReferences(references, inReplyTo);

  const rawMessage = buildDraftRawMessage({
    to: to.join(", "),
    cc: cc && cc.length > 0 ? cc.join(", ") : undefined,
    subject: reSubject,
    inReplyTo,
    references: fullReferences,
    body,
  });

  const response = await withRetry(() =>
    gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          threadId,
          raw: rawMessage,
        },
      },
    })
  );

  const draft = response.data;

  return {
    draftId: draft.id!,
    messageId: draft.message?.id ?? "",
    threadId: draft.message?.threadId ?? threadId,
  };
}

interface DraftRawParams {
  to: string;
  cc?: string;
  subject: string;
  inReplyTo: string;
  references: string;
  body: string;
}

function buildDraftRawMessage(params: DraftRawParams): string {
  const { to, cc, subject, inReplyTo, references, body } = params;

  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${references}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    "",
    body,
  ];

  const message = lines.join("\r\n");

  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
