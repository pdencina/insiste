"use client";

import { useState } from "react";
import { fetchSede } from "./sesion";

export interface MensajeChat {
  id: string;
  texto: string;
  tipo: "incoming" | "outgoing";
  autor: string | null;
  creadoEn: number;
}

const hora = (t: number) =>
  new Date(t * 1000).toLocaleString("es-CL", { timeZone: "America/Santiago", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Conversación y respuesta desde el panel: muestra los últimos mensajes (webhook),
 * redacta un borrador con IA y, al aprobarlo, lo envía por WhatsApp vía Salesbot.
 */
export function RespuestaChat({
  slug,
  leadId,
  nombre,
  programa,
  mensajes,
  ventanaAbierta,
  configListo,
}: {
  slug: string;
  leadId: number;
  nombre: string;
  programa: string | null;
  mensajes: MensajeChat[];
  ventanaAbierta: boolean;
  configListo: boolean | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pegado, setPegado] = useState("");
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [escalar, setEscalar] = useState(false);
  const [redactando, setRedactando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const redactar = async () => {
    setRedactando(true);
    setError("");
    try {
      const res = await fetchSede(slug, "/api/panel/redactar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, nombre, programa, mensaje: mensajes.length ? undefined : pegado }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo redactar");
      setTexto(data.respuesta);
      setMotivo(data.motivo);
      setEscalar(Boolean(data.escalar));
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
    setRedactando(false);
  };

  const enviar = async () => {
    if (!texto.trim()) return;
    if (!window.confirm(`Enviar por WhatsApp a ${nombre}:\n\n${texto.trim()}\n\n¿Confirmas?`)) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetchSede(slug, "/api/panel/responder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, texto }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo enviar");
      setEnviado(true);
      setTexto("");
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
    setEnviando(false);
  };

  const motivoBloqueo = !ventanaAbierta
    ? "Ventana de 24 h cerrada: WhatsApp no permite escribir hasta que la familia vuelva a escribir."
    : configListo === false
      ? "Falta configurar el Salesbot \"Enviar respuesta Insiste\" en Kommo."
      : "";

  return (
    <div className="mt-3">
      {mensajes.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {mensajes.map((m) => (
            <div key={m.id} className={`max-w-[85%] px-2 py-1 rounded text-xs ${m.tipo === "incoming" ? "self-start bg-[var(--background)] border border-[var(--border)]" : "self-end bg-blue-900/40"}`}>
              <p className="whitespace-pre-wrap">{m.texto || "(archivo o imagen)"}</p>
              <p className="text-[9px] text-[var(--muted)] mt-0.5">{m.tipo === "incoming" ? nombre : m.autor ?? "AR School"} · {hora(m.creadoEn)}</p>
            </div>
          ))}
        </div>
      )}

      {!abierto ? (
        <button onClick={() => setAbierto(true)} className="px-2 py-1 rounded text-[10px] font-medium bg-green-700 hover:bg-green-800 text-white">
          ✍️ Responder desde Insiste
        </button>
      ) : (
        <div className="p-3 rounded border border-[var(--border)] bg-[var(--background)]">
          {enviado && <p className="text-xs text-green-400 mb-2">✅ Enviado por WhatsApp. Aparecerá en el chat de Kommo en unos segundos.</p>}
          {mensajes.length === 0 && (
            <textarea
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={2}
              placeholder="Aún no hay mensajes guardados de este chat: pega lo que escribió la familia"
              className="w-full p-2 mb-2 rounded bg-[var(--card)] border border-[var(--border)] text-xs focus:outline-none focus:border-[var(--accent)]"
            />
          )}
          <div className="flex gap-2 mb-2">
            <button
              onClick={redactar}
              disabled={redactando || (mensajes.length === 0 && !pegado.trim())}
              className="px-3 py-1 rounded text-[11px] font-medium bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
            >
              {redactando ? "Redactando…" : "Redactar con IA"}
            </button>
            <button onClick={() => setAbierto(false)} className="text-[11px] text-[var(--muted)] hover:underline">Cerrar</button>
          </div>
          {escalar && (
            <p className="text-[11px] text-orange-300 mb-1">⚠ Tema sensible: revísalo personalmente antes de enviar.</p>
          )}
          {motivo && <p className="text-[10px] text-[var(--muted)] mb-1">{motivo}</p>}
          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setEnviado(false); }}
            rows={Math.min(12, Math.max(4, texto.split("\n").length + 1))}
            placeholder="Escribe o redacta con IA; puedes editar antes de enviar"
            className="w-full p-2 rounded bg-[var(--card)] border border-[var(--border)] text-xs focus:outline-none focus:border-[var(--accent)]"
          />
          {/\[[^\]]+\]/.test(texto) && <p className="text-[10px] text-yellow-300 mt-1">Completa los [CORCHETES] antes de enviar.</p>}
          {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={enviar}
              disabled={enviando || !texto.trim() || Boolean(motivoBloqueo) || /\[[^\]]+\]/.test(texto)}
              className="px-4 py-1.5 rounded text-xs font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              {enviando ? "Enviando…" : "Enviar por WhatsApp"}
            </button>
            {motivoBloqueo && <span className="text-[10px] text-[var(--muted)]">{motivoBloqueo}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
