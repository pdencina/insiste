"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface Conversacion {
  id: number;
  contactName: string;
  contactId: number;
  leadId: number | null;
  leadName: string | null;
  pipelineName: string | null;
  sede: string | null;
  horasRestantes: number;
  minutosRestantes: number;
  estado: string;
  isRead: boolean;
}

// Usuarios por sede — contraseña simple para cada responsable
const USUARIOS_SEDE: Record<string, { nombre: string; responsable: string; password: string; sedeNombre: string }> = {
  "puente-alto": { nombre: "Puente Alto", responsable: "Pr Pablo", password: "pa2026", sedeNombre: "Puente Alto" },
  "santiago": { nombre: "Santiago", responsable: "Pr Patricio Andrés", password: "stgo2026", sedeNombre: "Santiago" },
  "punta-arenas": { nombre: "Punta Arenas", responsable: "Pastor Jesús", password: "ptas2026", sedeNombre: "Punta Arenas" },
};

export default function SedePage() {
  const params = useParams();
  const slug = params.slug as string;
  const sedeInfo = USUARIOS_SEDE[slug];

  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [errorLogin, setErrorLogin] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");

  // Check stored session
  useEffect(() => {
    const stored = localStorage.getItem(`sede_${slug}`);
    if (stored === "ok") setAuthenticated(true);
  }, [slug]);

  const login = () => {
    if (!sedeInfo) {
      setErrorLogin("Sede no encontrada");
      return;
    }
    if (password === sedeInfo.password) {
      localStorage.setItem(`sede_${slug}`, "ok");
      setAuthenticated(true);
      setErrorLogin("");
    } else {
      setErrorLogin("Contraseña incorrecta");
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      // Usar CRON_SECRET interno para la API
      const res = await fetch(`/api/panel/whatsapp?sede=${encodeURIComponent(sedeInfo?.sedeNombre ?? "")}`, {
        headers: { "x-sede-auth": slug },
      });
      const data = await res.json();
      if (data.ok) {
        const filtradas = (data.conversaciones ?? []).filter(
          (c: Conversacion) => c.sede?.toLowerCase() === sedeInfo?.sedeNombre.toLowerCase()
        );
        setConversaciones(filtradas);
      } else {
        setError(data.error || "Error al cargar");
      }
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authenticated) fetchData();
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [authenticated]);

  if (!sedeInfo) {
    return (
      <div className="flex items-center justify-center w-full min-h-screen">
        <p className="text-red-400 text-lg">Sede no encontrada</p>
      </div>
    );
  }

  // Login screen
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center w-full min-h-screen">
        <div className="p-8 rounded-lg border border-[var(--border)] bg-[var(--card)] w-full max-w-sm">
          <h1 className="text-xl font-bold mb-1">WhatsApp 24h</h1>
          <p className="text-sm text-[var(--muted)] mb-6">{sedeInfo.nombre} — {sedeInfo.responsable}</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="Contraseña"
            className="w-full p-3 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
          />
          {errorLogin && <p className="text-red-400 text-xs mt-2">{errorLogin}</p>}
          <button
            onClick={login}
            className="mt-4 w-full p-3 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-sm transition-colors"
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  // Filtrar por estado
  const convsFiltradas = filtroEstado === "todos"
    ? conversaciones
    : conversaciones.filter((c) => c.estado === filtroEstado);

  const resumen = {
    expirados: conversaciones.filter((c) => c.estado === "expirado").length,
    criticos: conversaciones.filter((c) => c.estado === "critico").length,
    alertas: conversaciones.filter((c) => c.estado === "alerta").length,
    ok: conversaciones.filter((c) => c.estado === "ok").length,
  };

  return (
    <div className="w-full min-h-screen p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">WhatsApp 24h — {sedeInfo.nombre}</h1>
          <p className="text-sm text-[var(--muted)]">{sedeInfo.responsable} — Se actualiza cada 60s</p>
        </div>
        <button onClick={fetchData} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>

      {loading && <p className="text-[var(--muted)] text-sm">Cargando...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && (
        <>
          {/* Resumen clickeable */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <button
              onClick={() => setFiltroEstado(filtroEstado === "expirado" ? "todos" : "expirado")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "expirado" ? "border-red-400 ring-2 ring-red-400/50" : "border-red-800"} bg-red-950/30 hover:border-red-400`}
            >
              <p className="text-2xl font-bold text-red-400">{resumen.expirados}</p>
              <p className="text-xs text-red-300">Expirados</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "critico" ? "todos" : "critico")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "critico" ? "border-orange-400 ring-2 ring-orange-400/50" : "border-orange-800"} bg-orange-950/30 hover:border-orange-400`}
            >
              <p className="text-2xl font-bold text-orange-400">{resumen.criticos}</p>
              <p className="text-xs text-orange-300">Criticos</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "alerta" ? "todos" : "alerta")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "alerta" ? "border-yellow-400 ring-2 ring-yellow-400/50" : "border-yellow-800"} bg-yellow-950/30 hover:border-yellow-400`}
            >
              <p className="text-2xl font-bold text-yellow-400">{resumen.alertas}</p>
              <p className="text-xs text-yellow-300">Alerta</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "ok" ? "todos" : "ok")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "ok" ? "border-green-400 ring-2 ring-green-400/50" : "border-green-800"} bg-green-950/30 hover:border-green-400`}
            >
              <p className="text-2xl font-bold text-green-400">{resumen.ok}</p>
              <p className="text-xs text-green-300">OK</p>
            </button>
          </div>

          {filtroEstado !== "todos" && (
            <p className="text-xs text-[var(--muted)] mb-3">
              Filtrando: <span className="font-medium text-white">{filtroEstado}</span> — <button onClick={() => setFiltroEstado("todos")} className="text-[var(--accent)] hover:underline">ver todos</button>
            </p>
          )}

          {/* Resumen ejecutivo */}
          {resumen.criticos > 0 && (
            <div className="mb-4 p-3 rounded border border-orange-600 bg-orange-950/20">
              <p className="text-xs text-orange-300 font-medium">
                ⚡ {resumen.criticos} conversacion{resumen.criticos > 1 ? "es" : ""} por vencer en menos de 2 horas. Responde ahora para no perder estos leads.
              </p>
            </div>
          )}
          {resumen.expirados > 0 && filtroEstado === "todos" && (
            <div className="mb-4 p-3 rounded border border-red-800 bg-red-950/10">
              <p className="text-xs text-red-300">
                {resumen.expirados} lead{resumen.expirados > 1 ? "s" : ""} con ventana vencida. Usa el botón "Reactivar" para generar un mensaje de reconexión.
              </p>
            </div>
          )}

          {/* Lista */}
          {convsFiltradas.length === 0 && <p className="text-[var(--muted)] text-sm">No hay conversaciones con ese filtro</p>}
          <div className="flex flex-col gap-2">
            {convsFiltradas.map((conv) => (
              <ConversacionCard key={conv.id} conv={conv} slug={slug} sedeNombre={sedeInfo.sedeNombre} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConversacionCard({ conv, slug, sedeNombre }: { conv: Conversacion; slug: string; sedeNombre: string }) {
  const [mensajeIA, setMensajeIA] = useState("");
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const subdomain = "contactoarschoolglobalcom";

  const generarMensaje = async () => {
    setGenerando(true);
    try {
      const res = await fetch("/api/panel/reactivar", {
        method: "POST",
        headers: { "x-sede-auth": slug, "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: conv.contactName,
          leadName: conv.leadName,
          pipelineName: conv.pipelineName,
          sede: sedeNombre,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMensajeIA(data.mensaje);
      }
    } catch (err) {
      console.error(err);
    }
    setGenerando(false);
  };

  const copiarMensaje = () => {
    navigator.clipboard.writeText(mensajeIA);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const kommoUrl = conv.leadId
    ? `https://${subdomain}.kommo.com/leads/detail/${conv.leadId}`
    : `https://${subdomain}.kommo.com/contacts/detail/${conv.contactId}`;

  return (
    <div
      className={`p-4 rounded border bg-[var(--card)] ${
        conv.estado === "expirado" ? "border-red-600 bg-red-950/20" :
        conv.estado === "critico" ? "border-orange-600 bg-orange-950/20" :
        conv.estado === "alerta" ? "border-yellow-600 bg-yellow-950/10" :
        "border-[var(--border)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{conv.contactName}</span>
          {conv.leadName && (
            <p className="text-xs text-[var(--muted)] mt-0.5">{conv.leadName}</p>
          )}
          {conv.pipelineName && (
            <p className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 inline-block">{conv.pipelineName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Acciones */}
          <div className="flex gap-1">
            {conv.estado === "expirado" && (
              <button
                onClick={generarMensaje}
                disabled={generando}
                className="px-2 py-1 rounded text-[10px] font-medium bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
              >
                {generando ? "..." : "Reactivar"}
              </button>
            )}
            <a
              href={kommoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Ver en Kommo
            </a>
          </div>
          {/* Timer */}
          <div className="text-right ml-2">
            <p className={`text-sm font-bold ${
              conv.estado === "expirado" ? "text-red-400" :
              conv.estado === "critico" ? "text-orange-400" :
              conv.estado === "alerta" ? "text-yellow-400" :
              "text-green-400"
            }`}>
              {conv.estado === "expirado" ? "EXPIRADO" :
               conv.horasRestantes < 1 ? `${conv.minutosRestantes} min` :
               `${conv.horasRestantes}h`}
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {conv.estado === "expirado" ? "Ventana cerrada" : "restantes"}
            </p>
          </div>
        </div>
      </div>

      {/* Mensaje de reactivación generado */}
      {mensajeIA && (
        <div className="mt-3 p-3 rounded bg-[var(--background)] border border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-purple-300 font-medium">Mensaje de reconexión sugerido:</p>
            <button
              onClick={copiarMensaje}
              className="px-2 py-0.5 rounded text-[10px] bg-green-600 hover:bg-green-700 text-white transition-colors"
            >
              {copiado ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-[var(--foreground)] whitespace-pre-wrap">{mensajeIA}</p>
        </div>
      )}
    </div>
  );
}
