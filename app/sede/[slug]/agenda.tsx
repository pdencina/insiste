"use client";

import { useState } from "react";
import { PLANTILLAS } from "@/lib/kommo/plantillas";
import { fetchSede } from "./sesion";

interface Slot { inicio: number; libre: boolean; choque?: string }
interface Evento { inicio: number; fin: number; titulo: string }
interface Dia { fecha: string; horarios: number[]; slots: Slot[]; eventos: Evento[] }
interface Agendada { titulo: string; tipo: "visita" | "adaptacion"; inicio: number }

const TZ = "America/Santiago";
const hora = (t: number) => new Date(t * 1000).toLocaleTimeString("es-CL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const diaCorto = (t: number) => new Date(t * 1000).toLocaleDateString("es-CL", { timeZone: TZ, weekday: "long", day: "numeric" });
const diaLargo = (t: number) => new Date(t * 1000).toLocaleDateString("es-CL", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const tituloDia = (fecha: string) =>
  new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "short" });

/** Unix de "YYYY-MM-DD" + "HH:MM" en hora Chile (3 h en verano, 4 en invierno). */
function unixChile(fecha: string, hhmm: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  const horaEnChile = Number(
    new Date(Date.UTC(y, m - 1, d, 12)).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hour12: false })
  );
  return Date.UTC(y, m - 1, d, h + (12 - horaEnChile), min) / 1000;
}

function textoPlantilla(id: string) {
  return PLANTILLAS.find((p) => p.id === id)?.texto ?? "";
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
      className="px-2 py-1 rounded text-[10px] font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
    >
      {copiado ? "Copiado!" : "Copiar"}
    </button>
  );
}

/**
 * Agenda de visitas: horarios libres según Google Calendar, propuesta de dos
 * horarios para la familia (plantilla 8.1) y creación de la cita (plantilla 8.4).
 */
export function PanelAgenda({ slug }: { slug: string }) {
  const [abierto, setAbierto] = useState(false);
  const [duracion, setDuracion] = useState(60);
  const [dias, setDias] = useState<Dia[]>([]);
  const [agendadas, setAgendadas] = useState<Agendada[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [propuesta, setPropuesta] = useState("");

  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  // Eventos con los que choca el horario elegido (vacío = libre)
  const [choques, setChoques] = useState<string[]>([]);
  const [otraFecha, setOtraFecha] = useState("");
  const [otraHora, setOtraHora] = useState("");
  const [verificando, setVerificando] = useState(false);
  const [verificado, setVerificado] = useState<{ inicio: number; choques: Evento[] } | null>(null);

  const elegir = (inicio: number, conQue: string[] = []) => {
    setSeleccionado(inicio);
    setChoques(conQue);
    setCreada(null);
  };

  /** Revisa en el calendario un horario que propone la familia (cualquier día y hora). */
  const verificarOtro = async () => {
    if (!otraFecha || !otraHora) return;
    const inicio = unixChile(otraFecha, otraHora);
    if (inicio < Date.now() / 1000) {
      setError("Ese horario ya pasó");
      return;
    }
    setVerificando(true);
    setError("");
    try {
      const res = await fetchSede(slug, `/api/panel/agenda?verificar=${inicio}&duracion=${duracion}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo revisar el horario");
      setVerificado({ inicio, choques: data.choques });
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
    setVerificando(false);
  };
  const [programa, setPrograma] = useState<"Play Group" | "AR School">("Play Group");
  const [detalle, setDetalle] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [creando, setCreando] = useState(false);
  const [creada, setCreada] = useState<{ titulo: string; link: string; inicio: number; confirmacion: string; invitacion: boolean } | null>(null);

  const cargar = async (dur = duracion) => {
    setCargando(true);
    setError("");
    try {
      const res = await fetchSede(slug, `/api/panel/agenda?dias=10&duracion=${dur}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo leer la agenda");
      setDias(data.dias);
      setAgendadas(data.agendadas);
    } catch (err) {
      setError(String(err));
    }
    setCargando(false);
  };

  const abrir = () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && dias.length === 0) cargar();
  };

  /** Plantilla 8.1 con los dos primeros horarios libres de días distintos. */
  const proponer = () => {
    const opciones = dias.filter((d) => d.horarios.length > 0).slice(0, 2).map((d) => d.horarios[0]);
    if (opciones.length < 2) {
      setPropuesta("No hay dos días con horarios libres en las próximas dos semanas.");
      return;
    }
    const [a, b] = opciones;
    const texto = textoPlantilla("8.1")
      .replace("[DÍA 1]", `${diaCorto(a)} a las ${hora(a)}`)
      .replace("[DÍA 2]", `${diaCorto(b)} a las ${hora(b)}`)
      .replaceAll("[NOMBRE]", nombre.trim().split(/\s+/)[0] || "[NOMBRE]");
    setPropuesta(texto);
  };

  const crear = async () => {
    if (seleccionado === null || !detalle.trim()) return;
    const resumen = `Crear en tu Google Calendar:\n\nVisita Admisión | ${programa} | ${detalle.trim()}\n${diaLargo(seleccionado)} a las ${hora(seleccionado)} (${duracion} min)${
      email.trim() ? `\n\nSe enviará una invitación a ${email.trim()}` : ""
    }${choques.length ? `\n\n⚠ OJO: ese horario ya tiene:\n- ${choques.join("\n- ")}\nSe agendará igual, en paralelo.` : ""}\n\n¿Confirmas?`;
    if (!window.confirm(resumen)) return;

    setCreando(true);
    setError("");
    try {
      const res = await fetchSede(slug, "/api/panel/agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programa, detalle, inicio: seleccionado, duracionMin: duracion, emailFamilia: email.trim() || undefined, forzar: choques.length > 0 }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "No se pudo crear la cita");
      const confirmacion = textoPlantilla("8.4")
        .replace("[DÍA]", diaLargo(seleccionado))
        .replace("[HORA]", hora(seleccionado))
        .replaceAll("[NOMBRE]", nombre.trim().split(/\s+/)[0] || "[NOMBRE]");
      setCreada({ titulo: data.titulo, link: data.link, inicio: seleccionado, confirmacion, invitacion: data.invitacionEnviada });
      setSeleccionado(null);
      setChoques([]);
      setVerificado(null);
      setDetalle("");
      setEmail("");
      cargar();
    } catch (err) {
      setError(String(err).replace(/^Error: /, ""));
    }
    setCreando(false);
  };

  const input = "p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]";

  return (
    <div className="mb-6 rounded border border-[var(--border)] bg-[var(--card)]">
      <button onClick={abrir} className="w-full p-4 flex items-center justify-between text-left">
        <span className="text-sm font-bold">📅 Agenda de visitas</span>
        <span className="text-xs text-[var(--muted)]">{abierto ? "Cerrar" : "Horarios libres · Abrir"}</span>
      </button>

      {abierto && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="text-xs text-[var(--muted)]">Duración</label>
            <select
              value={duracion}
              onChange={(e) => {
                const d = Number(e.target.value);
                setDuracion(d);
                setSeleccionado(null);
                cargar(d);
              }}
              className={input}
            >
              {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del apoderado (para el mensaje)" className={`${input} flex-1 min-w-[180px]`} />
            <button onClick={proponer} disabled={cargando || dias.length === 0} className="px-3 py-2 rounded bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium disabled:opacity-50">
              Proponer 2 horarios
            </button>
            <button onClick={() => cargar()} className="text-xs text-[var(--accent)] hover:underline">Actualizar</button>
          </div>

          {propuesta && (
            <div className="mb-4 p-3 rounded bg-[var(--background)] border border-purple-800">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-purple-300">Mensaje para la familia (plantilla 8.1)</span>
                <BotonCopiar texto={propuesta} />
              </div>
              <p className="text-xs whitespace-pre-wrap">{propuesta}</p>
            </div>
          )}

          {cargando && <p className="text-xs text-[var(--muted)]">Leyendo tu calendario…</p>}
          {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

          {creada && (
            <div className="mb-4 p-3 rounded border border-green-700 bg-green-950/20">
              <p className="text-xs text-green-300 font-medium">
                ✅ Cita creada: {creada.titulo} — {diaLargo(creada.inicio)} a las {hora(creada.inicio)}
                {creada.invitacion ? " · invitación enviada" : ""}
                {creada.link && (
                  <> · <a href={creada.link} target="_blank" rel="noopener noreferrer" className="underline">ver en Calendar</a></>
                )}
              </p>
              <div className="mt-2 p-2 rounded bg-[var(--background)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-[var(--muted)]">Confirmación para la familia (plantilla 8.4)</span>
                  <BotonCopiar texto={creada.confirmacion} />
                </div>
                <p className="text-xs whitespace-pre-wrap">{creada.confirmacion}</p>
              </div>
            </div>
          )}

          {!cargando && dias.length > 0 && (
            <>
              <p className="text-xs font-bold text-[var(--muted)] mb-1">Horarios (elige uno para agendar)</p>
              <p className="text-[10px] text-[var(--muted)] mb-2">
                Libre: <span className="px-1 border border-[var(--border)] rounded">09:00</span> · Ocupado:{" "}
                <span className="px-1 border border-red-900 rounded line-through opacity-60">09:00</span> (pasa el mouse para ver con qué)
              </p>
              <div className="flex flex-col gap-3">
                {dias.map((d) => (
                  <div key={d.fecha}>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-xs w-28 shrink-0 capitalize">{tituloDia(d.fecha)}</span>
                      {d.slots.length === 0 && <span className="text-[10px] text-[var(--muted)]">sin horarios disponibles</span>}
                      {d.slots.map((sl) => (
                        <button
                          key={sl.inicio}
                          onClick={() => elegir(sl.inicio, sl.choque ? [sl.choque] : [])}
                          title={sl.libre ? "Libre" : `Ocupado: ${sl.choque}`}
                          className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                            seleccionado === sl.inicio
                              ? sl.libre ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-orange-700 border-orange-600 text-white"
                              : sl.libre ? "border-[var(--border)] hover:border-[var(--accent)]" : "border-red-900 line-through opacity-50 hover:opacity-80"
                          }`}
                        >
                          {hora(sl.inicio)}
                        </button>
                      ))}
                    </div>
                    {d.eventos.length > 0 && (
                      <p className="text-[10px] text-[var(--muted)] mt-1 ml-28 pl-1">
                        Ya agendado: {d.eventos.map((e) => `${hora(e.inicio)}–${hora(e.fin)} ${e.titulo}`).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Horario propuesto por la familia: cualquier día y hora, con aviso de choques */}
          {!cargando && (
            <div className="mt-4 p-3 rounded border border-[var(--border)] bg-[var(--background)]">
              <p className="text-xs font-bold mb-2">¿La familia propone otro horario?</p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="date" value={otraFecha} onChange={(e) => { setOtraFecha(e.target.value); setVerificado(null); }} className={input} />
                <input type="time" step={900} value={otraHora} onChange={(e) => { setOtraHora(e.target.value); setVerificado(null); }} className={input} />
                <button onClick={verificarOtro} disabled={verificando || !otraFecha || !otraHora} className="px-3 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium disabled:opacity-50">
                  {verificando ? "Revisando…" : "Revisar en mi calendario"}
                </button>
              </div>
              {verificado && (
                <div className="mt-2 text-xs">
                  {verificado.choques.length === 0 ? (
                    <p className="text-green-400">✅ Libre: <span className="capitalize">{diaLargo(verificado.inicio)}</span> a las {hora(verificado.inicio)} ({duracion} min)</p>
                  ) : (
                    <>
                      <p className="text-orange-300">⚠ Ese horario choca con:</p>
                      {verificado.choques.map((c, i) => (
                        <p key={i} className="text-[11px] text-orange-200 ml-3">• {hora(c.inicio)}–{hora(c.fin)} {c.titulo}</p>
                      ))}
                    </>
                  )}
                  <button
                    onClick={() => elegir(verificado.inicio, verificado.choques.map((c) => `${hora(c.inicio)}–${hora(c.fin)} ${c.titulo}`))}
                    className={`mt-2 px-3 py-1 rounded text-[11px] font-medium text-white ${verificado.choques.length ? "bg-orange-700 hover:bg-orange-800" : "bg-green-600 hover:bg-green-700"}`}
                  >
                    {verificado.choques.length ? "Agendar igual en este horario" : "Usar este horario"}
                  </button>
                </div>
              )}
            </div>
          )}

          {seleccionado !== null && (
            <div className="mt-4 p-3 rounded border border-[var(--accent)] bg-[var(--background)]">
              <p className="text-xs mb-2">
                Nueva visita: <span className="font-medium capitalize">{diaLargo(seleccionado)}</span> a las <span className="font-medium">{hora(seleccionado)}</span> ({duracion} min)
              </p>
              {choques.length > 0 && (
                <p className="text-[11px] text-orange-300 mb-2">⚠ Choca con: {choques.join(" · ")}. Si confirmas, quedan en paralelo.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <select value={programa} onChange={(e) => setPrograma(e.target.value as typeof programa)} className={input}>
                  <option>Play Group</option>
                  <option>AR School</option>
                </select>
                <input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Familia / niño (ej: Lucas 3 años)" className={`${input} flex-1 min-w-[180px]`} />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo de la familia (opcional, envía invitación)" className={`${input} flex-1 min-w-[220px]`} />
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={crear} disabled={creando || !detalle.trim()} className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50">
                  {creando ? "Creando…" : "Crear cita en mi Google Calendar"}
                </button>
                <button onClick={() => { setSeleccionado(null); setChoques([]); }} className="text-xs text-[var(--muted)] hover:underline">Cancelar</button>
              </div>
            </div>
          )}

          {agendadas.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-bold text-[var(--muted)] mb-1">Ya agendadas</p>
              {agendadas.map((v, i) => (
                <p key={i} className="text-xs text-[var(--muted)]">
                  <span className="capitalize">{diaCorto(v.inicio)}</span> {hora(v.inicio)} · {v.titulo}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
