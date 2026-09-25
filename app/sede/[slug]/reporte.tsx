"use client";

import { useState } from "react";
import { fetchSede } from "./sesion";

/** "YYYY-MM-DD" en hora Chile, desplazado `dias`. */
function fechaChile(dias = 0): string {
  return new Date(Date.now() + dias * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

function semanaActual() {
  const diasDesdeLunes = (new Date(`${fechaChile()}T12:00:00Z`).getUTCDay() + 6) % 7;
  return { desde: fechaChile(-diasDesdeLunes), hasta: fechaChile(4 - diasDesdeLunes) };
}

/**
 * Reporte de gestión de admisión para un período: texto en el formato oficial,
 * listo para copiar. Solo Playgroup y AR School Puente Alto.
 */
export function PanelReporte({ slug }: { slug: string }) {
  const semana = semanaActual();
  const [abierto, setAbierto] = useState(false);
  const [desde, setDesde] = useState(semana.desde);
  const [hasta, setHasta] = useState(semana.hasta);
  const [cargando, setCargando] = useState(false);
  const [texto, setTexto] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState(false);

  const generar = async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetchSede(slug, `/api/panel/reporte?desde=${desde}&hasta=${hasta}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo generar");
      setTexto(data.texto);
      setNotas(data.notas);
    } catch (err) {
      setError(String(err));
    }
    setCargando(false);
  };

  const copiar = () => {
    navigator.clipboard.writeText(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="mb-6 rounded border border-[var(--border)] bg-[var(--card)]">
      <button onClick={() => setAbierto(!abierto)} className="w-full p-4 flex items-center justify-between text-left">
        <span className="text-sm font-bold">📊 Reporte de gestión</span>
        <span className="text-xs text-[var(--muted)]">{abierto ? "Cerrar" : "Playgroup + AR School · Abrir"}</span>
      </button>

      {abierto && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              Desde
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="block mt-1 p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)]"
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Hasta
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="block mt-1 p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm text-[var(--foreground)]"
              />
            </label>
            <button
              onClick={generar}
              disabled={cargando || !desde || !hasta}
              className="px-4 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50"
            >
              {cargando ? "Calculando…" : "Generar"}
            </button>
          </div>
          {cargando && <p className="text-[10px] text-[var(--muted)] mt-2">Puede tardar hasta 30 segundos en períodos largos.</p>}
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

          {texto && (
            <div className="mt-4">
              <div className="p-3 rounded bg-[var(--background)] border border-[var(--border)]">
                <div className="flex justify-end mb-1">
                  <button
                    onClick={copiar}
                    className="px-2 py-1 rounded text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
                  >
                    {copiado ? "Copiado!" : "Copiar"}
                  </button>
                </div>
                <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{texto}</pre>
              </div>
              <details className="mt-2">
                <summary className="text-[10px] text-[var(--muted)] cursor-pointer">Cómo se calculó cada número</summary>
                <pre className="text-[10px] text-[var(--muted)] whitespace-pre-wrap font-sans mt-1">{notas}</pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
