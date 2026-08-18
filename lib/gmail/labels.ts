/**
 * Gestión de etiquetas de Insiste en Gmail.
 *
 * Etiquetas:
 * - insiste/seguir    → El usuario marca un hilo para seguimiento (recordatorios)
 * - insiste/activo    → El agente está vigilando este hilo
 * - insiste/cerrado   → El seguimiento terminó
 * - insiste/responder → El usuario quiere que el agente redacte una respuesta
 */

import type { gmail_v1 } from "googleapis";
import { withRetry } from "./client";

export const LABEL_NAMES = {
  SEGUIR: "insiste/seguir",
  ACTIVO: "insiste/activo",
  CERRADO: "insiste/cerrado",
  RESPONDER: "insiste/responder",
} as const;

type LabelName = (typeof LABEL_NAMES)[keyof typeof LABEL_NAMES];

// Cache de IDs de etiquetas por sesión
const labelIdCache = new Map<string, string>();

/**
 * Obtiene el ID de una etiqueta por nombre. La crea si no existe.
 */
export async function ensureLabelId(
  gmail: gmail_v1.Gmail,
  labelName: LabelName
): Promise<string> {
  // Revisar cache
  if (labelIdCache.has(labelName)) {
    return labelIdCache.get(labelName)!;
  }

  // Buscar entre las etiquetas existentes
  const response = await withRetry(() =>
    gmail.users.labels.list({ userId: "me" })
  );

  const existing = (response.data.labels ?? []).find(
    (l) => l.name === labelName
  );

  if (existing?.id) {
    labelIdCache.set(labelName, existing.id);
    return existing.id;
  }

  // Crear la etiqueta
  const created = await withRetry(() =>
    gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    })
  );

  const id = created.data.id!;
  labelIdCache.set(labelName, id);
  return id;
}

/**
 * Aplica una etiqueta a un hilo (a todos sus mensajes).
 */
export async function addLabelToThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  labelName: LabelName
): Promise<void> {
  const labelId = await ensureLabelId(gmail, labelName);

  await withRetry(() =>
    gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: [labelId],
      },
    })
  );
}

/**
 * Remueve una etiqueta de un hilo.
 */
export async function removeLabelFromThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
  labelName: LabelName
): Promise<void> {
  const labelId = await ensureLabelId(gmail, labelName);

  await withRetry(() =>
    gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        removeLabelIds: [labelId],
      },
    })
  );
}

/**
 * Intercambia la etiqueta de un hilo: remueve una y aplica otra.
 * Usado para pasar de "seguir" a "activo", o de "activo" a "cerrado".
 */
export async function swapLabel(
  gmail: gmail_v1.Gmail,
  threadId: string,
  removeLabel: LabelName,
  addLabel: LabelName
): Promise<void> {
  const removeId = await ensureLabelId(gmail, removeLabel);
  const addId = await ensureLabelId(gmail, addLabel);

  await withRetry(() =>
    gmail.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: {
        addLabelIds: [addId],
        removeLabelIds: [removeId],
      },
    })
  );
}
