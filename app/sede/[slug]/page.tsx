"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";

interface Conversacion {
  id: number;
  contactName: string;
  leadName: string | null;
  sede: string | null;
  horasRestantes: number;
  minutosRestantes: number;
  estado: string;
  isRead: boolean;
}

const SEDES_VALIDAS: Record<string, { nombre: string; responsable: string }> = {
  "puente-alto": { nombre: "Puente Alto", responsable: "Pr Pablo" },
  "santiago": { nombre: "Santiago", responsable: "Pr Patricio Andrés" },
  "punta-arenas": { nombre: "Punta Arenas", responsable: "Pastor Jesús" },
};

export default function SedePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const token = searchParams.get("token");

  const sedeInfo = SEDES_VALIDAS[slug];
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = async () => {
    if (!token) {
      setError("Token no proporcionado");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/panel/whatsapp", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        // Filtrar solo la sede correspondiente
        const sedeNombre = sedeInfo?.nombre ?? "";
        const filtradas = (data.conversaciones ?? []).filter(
          (c: Conversacion) => c.sede?.toLowerCase() === sedeNombre.toLowerCase()
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

  useEffect(() => { fetchData(); }, []);
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!sedeInfo) {
    return (
      <div className="flex items-center justify-center w-full min-h-screen">
        <p className="text-red-400">Sede no encontrada</p>
      </div>
    );
  }

  const resumen = {
    expirados: conversaciones.filter((c) => c.estado === "expirado").length,
    criticos: conversaciones.filter((c) => c.estado === "critico").length,
    alertas: conversaciones.filter((c) => c.estado === "alerta").length,
    ok: conversaciones.filter((c) => c.estado === "ok").length,
  };

  return (
    <div className="w-full min-h-screen p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold">WhatsApp 24h — {sedeInfo.nombre}</h1>
        <p className="text-sm text-[var(--muted)]">Responsable: {sedeInfo.responsable} — Se actualiza cada 60s</p>
      </div>

      {loading && <p className="text-[var(--muted)] text-sm">Cargando...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="p-3 rounded border border-red-800 bg-red-950/30 text-center">
              <p className="text-2xl font-bold text-red-400">{resumen.expirados}</p>
              <p className="text-xs text-red-300">Expirados</p>
            </div>
            <div className="p-3 rounded border border-orange-800 bg-orange-950/30 text-center">
              <p className="text-2xl font-bold text-orange-400">{resumen.criticos}</p>
              <p className="text-xs text-orange-300">Criticos</p>
            </div>
            <div className="p-3 rounded border border-yellow-800 bg-yellow-950/30 text-center">
              <p className="text-2xl font-bold text-yellow-400">{resumen.alertas}</p>
              <p className="text-xs text-yellow-300">Alerta</p>
            </div>
            <div className="p-3 rounded border border-green-800 bg-green-950/30 text-center">
              <p className="text-2xl font-bold text-green-400">{resumen.ok}</p>
              <p className="text-xs text-green-300">OK</p>
            </div>
          </div>

          {/* Lista */}
          {conversaciones.length === 0 && <p className="text-[var(--muted)] text-sm">No hay conversaciones abiertas en {sedeInfo.nombre}</p>}
          <div className="flex flex-col gap-2">
            {conversaciones.map((conv) => (
              <div
                key={conv.id}
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
                  </div>
                  <div className="text-right shrink-0">
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
