"use client";

import { useState } from "react";
import { PLANTILLAS, type Plantilla } from "@/lib/kommo/plantillas";

type Sugerencia = Plantilla;

async function pedirSugerencias(slug: string, mensaje: string, nombre?: string, contexto?: string) {
  const res = await fetch("/api/panel/sugerir", {
    method: "POST",
    headers: { "x-sede-auth": slug, "Content-Type": "application/json" },
    body: JSON.stringify({ mensaje, nombre, contexto }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "No se pudo sugerir");
  return { sugerencias: data.sugerencias as Sugerencia[], motivo: data.motivo as string };
}

/** Texto de la plantilla con los [CORCHETES] resaltados para completarlos antes de enviar. */
function TextoPlantilla({ texto }: { texto: string }) {
  const partes = texto.split(/(\[[^\]]+\])/g);
  return (
    <p className="text-xs whitespace-pre-wrap leading-relaxed">
      {partes.map((p, i) =>
        /^\[[^\]]+\]$/.test(p) ? (
          <span key={i} className="px-0.5 rounded bg-yellow-500/20 text-yellow-300">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </p>
  );
}

function TarjetaPlantilla({ plantilla, abierta = false }: { plantilla: Plantilla; abierta?: boolean }) {
  const [expandida, setExpandida] = useState(abierta);
  const [copiado, setCopiado] = useState(false);

  const copiar = () => {
    navigator.clipboard.writeText(plantilla.texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="p-3 rounded border border-[var(--border)] bg-[var(--background)]">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setExpandida(!expandida)} className="text-left min-w-0 flex-1">
          <span className="text-[10px] text-[var(--muted)] mr-2">{plantilla.id}</span>
          <span className="text-sm">{plantilla.titulo}</span>
          {plantilla.tipo === "nota" && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">nota interna</span>
          )}
          {plantilla.requiereAutorizacion && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300">requiere autorización</span>
          )}
        </button>
        <button
          onClick={copiar}
          className="shrink-0 px-2 py-1 rounded text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
        >
          {copiado ? "Copiado!" : "Copiar"}
        </button>
      </div>
      {expandida && (
        <div className="mt-2">
          {plantilla.nota && <p className="text-[10px] text-orange-300 mb-2">⚠ {plantilla.nota}</p>}
          <TextoPlantilla texto={plantilla.texto} />
        </div>
      )}
    </div>
  );
}

/**
 * Panel de respuestas predefinidas: pegar lo que escribió la familia → sugerencias,
 * o buscar a mano en el catálogo completo.
 */
export function PanelRespuestas({ slug }: { slug: string }) {
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("");
  const [programa, setPrograma] = useState<"" | "PLAYGROUP PUENTE ALTO" | "AR SCHOOL PUENTE ALTO">("");
  const [sugiriendo, setSugiriendo] = useState(false);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const sugerir = async () => {
    if (!mensaje.trim()) return;
    setSugiriendo(true);
    setError("");
    try {
      const contexto = programa
        ? `Conversación del embudo ${programa}${programa.startsWith("PLAYGROUP") ? " (Play Group, 2 a 5 años)" : " (AR School: Pre-School a High School)"}`
        : undefined;
      const r = await pedirSugerencias(slug, mensaje, nombre || undefined, contexto);
      setSugerencias(r.sugerencias);
      setMotivo(r.motivo);
    } catch (err) {
      setError(String(err));
    }
    setSugiriendo(false);
  };

  const q = busqueda.trim().toLowerCase();
  const filtradas = q
    ? PLANTILLAS.filter((p) => `${p.id} ${p.seccion} ${p.titulo} ${p.texto}`.toLowerCase().includes(q))
    : PLANTILLAS;
  const secciones = [...new Set(filtradas.map((p) => p.seccion))];

  return (
    <div className="mb-6 rounded border border-[var(--border)] bg-[var(--card)]">
      <button onClick={() => setAbierto(!abierto)} className="w-full p-4 flex items-center justify-between text-left">
        <span className="text-sm font-bold">💬 Respuestas predefinidas</span>
        <span className="text-xs text-[var(--muted)]">{abierto ? "Cerrar" : `${PLANTILLAS.length} respuestas · Abrir`}</span>
      </button>

      {abierto && (
        <div className="px-4 pb-4">
          {/* Sugerir según lo que escribió la familia */}
          <p className="text-xs text-[var(--muted)] mb-2">Pega lo que te escribió la familia y te sugiero qué respuesta usar:</p>
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            rows={3}
            placeholder='Ej: "Hola, cuánto sale la mensualidad para mi hijo de 4 años?"'
            className="w-full p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2 mt-2">
            <select
              value={programa}
              onChange={(e) => setPrograma(e.target.value as typeof programa)}
              className="p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="">Programa…</option>
              <option value="PLAYGROUP PUENTE ALTO">Playgroup</option>
              <option value="AR SCHOOL PUENTE ALTO">AR School</option>
            </select>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre de la familia (opcional)"
              className="flex-1 p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={sugerir}
              disabled={sugiriendo || !mensaje.trim()}
              className="px-4 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50"
            >
              {sugiriendo ? "..." : "Sugerir"}
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          {sugerencias.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {motivo && <p className="text-[10px] text-[var(--muted)]">{motivo}</p>}
              {sugerencias.map((s, i) => (
                <TarjetaPlantilla key={s.id + s.texto.length} plantilla={s} abierta={i === 0} />
              ))}
            </div>
          )}

          {/* Catálogo completo */}
          <div className="mt-6">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar respuesta (ej: valores, PIE, visita, formulario...)"
              className="w-full p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            {secciones.map((seccion) => (
              <div key={seccion} className="mt-4">
                <p className="text-xs font-bold text-[var(--muted)] mb-2">{seccion}</p>
                <div className="flex flex-col gap-1">
                  {filtradas.filter((p) => p.seccion === seccion).map((p) => (
                    <TarjetaPlantilla key={q ? `${p.id}-q` : p.id} plantilla={p} abierta={Boolean(q)} />
                  ))}
                </div>
              </div>
            ))}
            {filtradas.length === 0 && <p className="text-xs text-[var(--muted)] mt-3">Sin resultados</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fila de un chat sin aceptar, con lo que escribió la familia y sugerencia de respuesta. */
export function FilaSinAceptar({
  slug,
  nombre,
  mensaje,
  canal,
  espera,
  urgente,
  url,
}: {
  slug: string;
  nombre: string;
  mensaje: string | null;
  canal: string;
  espera: string;
  urgente: boolean;
  url: string;
}) {
  const [sugerencias, setSugerencias] = useState<Sugerencia[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const sugerir = async () => {
    if (sugerencias) {
      setSugerencias(null);
      return;
    }
    setCargando(true);
    setError("");
    try {
      const r = await pedirSugerencias(
        slug,
        mensaje || "Hola, quiero información",
        nombre,
        `Primer contacto, llegó por ${canal} y nadie le ha respondido`
      );
      setSugerencias(r.sugerencias);
    } catch (err) {
      setError(String(err));
    }
    setCargando(false);
  };

  return (
    <div className="py-1 border-t border-red-900/50">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm">{nombre}</span>
          <span className="text-[10px] text-[var(--muted)] ml-2">{canal}</span>
          {mensaje && <p className="text-xs text-[var(--muted)] italic truncate">&ldquo;{mensaje}&rdquo;</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-bold ${urgente ? "text-red-400" : "text-yellow-400"}`}>{espera}</span>
          <button
            onClick={sugerir}
            disabled={cargando}
            className="px-2 py-1 rounded text-[10px] font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
          >
            {cargando ? "..." : sugerencias ? "Ocultar" : "Sugerir"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2 py-1 rounded text-[10px] font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Abrir
          </a>
        </div>
      </div>
      {(sugerencias || error) && (
        <div className="mt-2 mb-1 flex flex-col gap-1">
          {error && <p className="text-red-400 text-xs">{error}</p>}
          {sugerencias?.map((s, i) => (
            <TarjetaPlantilla key={s.id} plantilla={s} abierta={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
