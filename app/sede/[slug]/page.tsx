"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { PanelRespuestas, FilaSinAceptar } from "./respuestas";
import { PanelReporte } from "./reporte";
import { PanelAgenda } from "./agenda";
import { fetchSede, guardarToken, tokenSede } from "./sesion";
import { RespuestaChat, type MensajeChat } from "./respuesta-chat";

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
  minutosSinResponder: number;
  estado: string;
  estadoLabel: string;
  isRead: boolean;
}

interface ChatSinClasificar {
  uid: string;
  leadId: number | null;
  contactId: number | null;
  nombre: string;
  pipelineName: string | null;
  sede: string | null;
  origen: string;
  mensaje: string | null;
  respondido: boolean;
  minutosEsperando: number;
}

const KOMMO_SUBDOMAIN = "contactoarschoolglobalcom";

// Nombre visible de cada estado (el interno "atendido" = ya respondimos, esperando a la familia)
const ETIQUETAS_ESTADO: Record<string, string> = {
  pendiente: "Pendiente",
  demorado: "Demorado",
  frio: "Frío",
  expirado: "Expirado sin respuesta",
  atendido: "Respondido",
};

function formatearEspera(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }
  const dias = Math.floor(minutos / 1440);
  return dias === 1 ? "1 día" : `${dias} días`;
}

// Sedes del panel. La clave se valida en el servidor (/api/panel/login), no acá.
const USUARIOS_SEDE: Record<string, { nombre: string; responsable: string; sedeNombre: string }> = {
  "puente-alto": { nombre: "Puente Alto", responsable: "Pr Pablo", sedeNombre: "Puente Alto" },
  "santiago": { nombre: "Santiago", responsable: "Pr Patricio Andrés", sedeNombre: "Santiago" },
  "punta-arenas": { nombre: "Punta Arenas", responsable: "Pastor Jesús", sedeNombre: "Punta Arenas" },
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
  const [sinClasificar, setSinClasificar] = useState<ChatSinClasificar[]>([]);
  const [sinClasificarAntiguos, setSinClasificarAntiguos] = useState(0);
  const [verTodosSinClasificar, setVerTodosSinClasificar] = useState(false);
  const [verRespondidos, setVerRespondidos] = useState(false);
  // Textos de los chats (webhook de Kommo) y si el envío desde Insiste está configurado
  const [mensajes, setMensajes] = useState<Record<number, MensajeChat[]>>({});
  const [envioListo, setEnvioListo] = useState<boolean | null>(null);

  // Sesión guardada (token firmado por el servidor)
  useEffect(() => {
    if (tokenSede(slug)) setAuthenticated(true);
  }, [slug]);

  const login = async () => {
    if (!sedeInfo) {
      setErrorLogin("Sede no encontrada");
      return;
    }
    try {
      const res = await fetch("/api/panel/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, clave: password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setErrorLogin(data.error || "Contraseña incorrecta");
        return;
      }
      guardarToken(slug, data.token);
      setPassword("");
      setErrorLogin("");
      setAuthenticated(true);
    } catch (err) {
      setErrorLogin(`Error de red: ${String(err)}`);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchSede(slug, `/api/panel/whatsapp?sede=${encodeURIComponent(sedeInfo?.sedeNombre ?? "")}`);
      const data = await res.json();
      if (data.ok) {
        const filtradas = (data.conversaciones ?? []).filter(
          (c: Conversacion) => c.sede?.toLowerCase() === sedeInfo?.sedeNombre.toLowerCase()
        );
        setConversaciones(filtradas);
        setMensajes(data.mensajes ?? {});
        if (slug === "puente-alto" && envioListo === null) {
          fetchSede(slug, "/api/panel/responder")
            .then((r) => r.json())
            .then((d) => setEnvioListo(Boolean(d.listo)))
            .catch(() => setEnvioListo(false));
        }
        // Chats sin aceptar: solo los de los embudos de esta sede. Las entradas generales
        // (ARS_WHATSAPP, Instagram, Embudo de ventas) las atiende otro equipo.
        const sinAceptar = (data.sinClasificar?.recientes ?? []).filter(
          (c: ChatSinClasificar) => c.sede?.toLowerCase() === sedeInfo?.sedeNombre.toLowerCase()
        );
        setSinClasificar(sinAceptar);
        setSinClasificarAntiguos(data.sinClasificar?.antiguos ?? 0);
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

  const sinResponder = sinClasificar.filter((c) => !c.respondido);
  const respondidosSinAceptar = sinClasificar.filter((c) => c.respondido);

  // Filtrar por estado
  const convsFiltradas = filtroEstado === "todos"
    ? conversaciones
    : conversaciones.filter((c) => c.estado === filtroEstado);

  const resumen = {
    demorados: conversaciones.filter((c) => c.estado === "demorado").length,
    pendientes: conversaciones.filter((c) => c.estado === "pendiente").length,
    frios: conversaciones.filter((c) => c.estado === "frio").length,
    expirados: conversaciones.filter((c) => c.estado === "expirado").length,
    atendidos: conversaciones.filter((c) => c.estado === "atendido").length,
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

      {/* Fuera del bloque que se recarga cada 60s, para no perder lo escrito o generado */}
      <PanelRespuestas slug={slug} />
      <PanelReporte slug={slug} />
      {/* La agenda lee y escribe el Google Calendar de Pablo: solo Puente Alto */}
      {slug === "puente-alto" && <PanelAgenda slug={slug} />}

      {loading && <p className="text-[var(--muted)] text-sm">Cargando...</p>}
      {error && <p className="text-red-400 text-sm">Error: {error}</p>}

      {!loading && !error && (
        <>

          {/* Chats en "Incoming leads": sin respuesta (urgente) y respondidos pero sin aceptar */}
          {sinResponder.length > 0 && (
            <div className="mb-4 p-4 rounded border border-red-600 bg-red-950/30">
              <p className="text-sm font-bold text-red-300">
                🔴 {sinResponder.length} chat{sinResponder.length > 1 ? "s" : ""} sin responder
              </p>
              <p className="text-xs text-red-300/80 mt-1 mb-3">
                Están en &quot;Incoming leads&quot; y nadie del equipo respondió su último mensaje. No aparecen en la lista de abajo.
              </p>
              <div className="flex flex-col gap-1">
                {(verTodosSinClasificar ? sinResponder : sinResponder.slice(0, 8)).map((chat) => (
                  <FilaSinAceptar
                    key={chat.uid}
                    slug={slug}
                    nombre={chat.nombre}
                    mensaje={chat.mensaje}
                    canal={chat.pipelineName ?? chat.origen}
                    espera={formatearEspera(chat.minutosEsperando)}
                    urgente={chat.minutosEsperando >= 15}
                    url={chat.leadId
                      ? `https://${KOMMO_SUBDOMAIN}.kommo.com/leads/detail/${chat.leadId}`
                      : `https://${KOMMO_SUBDOMAIN}.kommo.com/leads/pipeline/`}
                  />
                ))}
              </div>
              {sinResponder.length > 8 && (
                <button
                  onClick={() => setVerTodosSinClasificar(!verTodosSinClasificar)}
                  className="mt-2 text-xs text-red-300 hover:underline"
                >
                  {verTodosSinClasificar ? "Ver menos" : `Ver los ${sinResponder.length}`}
                </button>
              )}
            </div>
          )}
          {(respondidosSinAceptar.length > 0 || sinClasificarAntiguos > 0) && (
            <div className="mb-6 p-3 rounded border border-[var(--border)] bg-[var(--card)]">
              {respondidosSinAceptar.length > 0 && (
                <button onClick={() => setVerRespondidos(!verRespondidos)} className="w-full flex items-center justify-between text-left">
                  <span className="text-xs text-[var(--muted)]">
                    ✅ {respondidosSinAceptar.length} respondido{respondidosSinAceptar.length > 1 ? "s" : ""} pero sin aceptar — acéptalos en Kommo y muévelos a su etapa
                  </span>
                  <span className="text-[10px] text-[var(--accent)]">{verRespondidos ? "Ocultar" : "Ver"}</span>
                </button>
              )}
              {verRespondidos && (
                <div className="flex flex-col gap-1 mt-2">
                  {respondidosSinAceptar.map((chat) => (
                    <FilaSinAceptar
                    key={chat.uid}
                    slug={slug}
                    nombre={chat.nombre}
                    mensaje={chat.mensaje}
                    canal={chat.pipelineName ?? chat.origen}
                    espera={formatearEspera(chat.minutosEsperando)}
                    urgente={false}
                    url={chat.leadId
                      ? `https://${KOMMO_SUBDOMAIN}.kommo.com/leads/detail/${chat.leadId}`
                      : `https://${KOMMO_SUBDOMAIN}.kommo.com/leads/pipeline/`}
                  />
                  ))}
                </div>
              )}
              {sinClasificarAntiguos > 0 && (
                <p className="text-[10px] text-[var(--muted)] mt-2">
                  + {sinClasificarAntiguos} con más de 7 días en &quot;Incoming leads&quot; (no se listan; pendiente limpieza).
                </p>
              )}
            </div>
          )}

          {/* Resumen clickeable */}
          <div className="grid grid-cols-5 gap-2 mb-6">
            <button
              onClick={() => setFiltroEstado(filtroEstado === "demorado" ? "todos" : "demorado")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "demorado" ? "border-orange-400 ring-2 ring-orange-400/50" : "border-orange-800"} bg-orange-950/30 hover:border-orange-400`}
            >
              <p className="text-2xl font-bold text-orange-400">{resumen.demorados}</p>
              <p className="text-[10px] text-orange-300">Demorado (+30 min)</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "pendiente" ? "todos" : "pendiente")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "pendiente" ? "border-yellow-400 ring-2 ring-yellow-400/50" : "border-yellow-800"} bg-yellow-950/30 hover:border-yellow-400`}
            >
              <p className="text-2xl font-bold text-yellow-400">{resumen.pendientes}</p>
              <p className="text-[10px] text-yellow-300">Pendiente (-30 min)</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "frio" ? "todos" : "frio")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "frio" ? "border-blue-400 ring-2 ring-blue-400/50" : "border-blue-800"} bg-blue-950/30 hover:border-blue-400`}
            >
              <p className="text-2xl font-bold text-blue-400">{resumen.frios}</p>
              <p className="text-[10px] text-blue-300">Frío (+2h)</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "expirado" ? "todos" : "expirado")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "expirado" ? "border-red-400 ring-2 ring-red-400/50" : "border-red-800"} bg-red-950/30 hover:border-red-400`}
            >
              <p className="text-2xl font-bold text-red-400">{resumen.expirados}</p>
              <p className="text-[10px] text-red-300">Expirado sin respuesta</p>
            </button>
            <button
              onClick={() => setFiltroEstado(filtroEstado === "atendido" ? "todos" : "atendido")}
              className={`p-3 rounded border text-center transition-all ${filtroEstado === "atendido" ? "border-green-400 ring-2 ring-green-400/50" : "border-green-800"} bg-green-950/30 hover:border-green-400`}
            >
              <p className="text-2xl font-bold text-green-400">{resumen.atendidos}</p>
              <p className="text-[10px] text-green-300">Respondido</p>
            </button>
          </div>

          {filtroEstado !== "todos" && (
            <p className="text-xs text-[var(--muted)] mb-3">
              Filtrando: <span className="font-medium text-white">{ETIQUETAS_ESTADO[filtroEstado] ?? filtroEstado}</span> — <button onClick={() => setFiltroEstado("todos")} className="text-[var(--accent)] hover:underline">ver todos</button>
            </p>
          )}

          {/* Resumen ejecutivo */}
          {resumen.demorados > 0 && (
            <div className="mb-4 p-3 rounded border border-orange-600 bg-orange-950/20">
              <p className="text-xs text-orange-300 font-medium">
                ⚡ {resumen.demorados} familia{resumen.demorados > 1 ? "s" : ""} esperando tu respuesta hace más de 30 minutos. Se enfría — responde ahora.
              </p>
            </div>
          )}
          {resumen.pendientes > 0 && (
            <div className="mb-4 p-3 rounded border border-yellow-800 bg-yellow-950/10">
              <p className="text-xs text-yellow-300">
                {resumen.pendientes} familia{resumen.pendientes > 1 ? "s" : ""} esperando respuesta (menos de 30 min). Aún estás a tiempo.
              </p>
            </div>
          )}
          {resumen.frios > 0 && (
            <div className="mb-4 p-3 rounded border border-blue-800 bg-blue-950/10">
              <p className="text-xs text-blue-300">
                {resumen.frios} familia{resumen.frios > 1 ? "s" : ""} esperando hace más de 2 horas. Todavía estás dentro de la ventana de 24h.
              </p>
            </div>
          )}
          {resumen.expirados > 0 && filtroEstado === "todos" && (
            <div className="mb-4 p-3 rounded border border-red-800 bg-red-950/10">
              <p className="text-xs text-red-300">
                {resumen.expirados} familia{resumen.expirados > 1 ? "s" : ""} escribieron y la ventana de 24h cerró sin respuesta. Usa &quot;Reactivar&quot; para reconectar.
              </p>
            </div>
          )}

          {/* Lista */}
          {convsFiltradas.length === 0 && <p className="text-[var(--muted)] text-sm">No hay conversaciones con ese filtro</p>}
          <div className="flex flex-col gap-2">
            {convsFiltradas.map((conv) => (
              <ConversacionCard
                key={conv.id}
                conv={conv}
                slug={slug}
                sedeNombre={sedeInfo.sedeNombre}
                mensajes={conv.leadId ? mensajes[conv.leadId] ?? [] : []}
                envioListo={envioListo}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConversacionCard({
  conv,
  slug,
  sedeNombre,
  mensajes,
  envioListo,
}: {
  conv: Conversacion;
  slug: string;
  sedeNombre: string;
  mensajes: MensajeChat[];
  envioListo: boolean | null;
}) {
  const [mensajeIA, setMensajeIA] = useState("");
  const [generando, setGenerando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const subdomain = KOMMO_SUBDOMAIN;

  const generarMensaje = async () => {
    setGenerando(true);
    try {
      const res = await fetchSede(slug, "/api/panel/reactivar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      } else {
        setMensajeIA(`Error: ${data.error || "No se pudo generar"}`);
      }
    } catch (err) {
      setMensajeIA(`Error de red: ${String(err)}`);
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
        conv.estado === "frio" ? "border-blue-600 bg-blue-950/20" :
        conv.estado === "demorado" ? "border-orange-600 bg-orange-950/20" :
        conv.estado === "pendiente" ? "border-yellow-600 bg-yellow-950/10" :
        "border-[var(--border)] opacity-70"
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
          {/* Estado y tiempos: cuánto espera la familia y cuánto queda de la ventana de 24h */}
          <div className="text-right ml-2 min-w-[96px]">
            <p className={`text-[10px] font-medium ${
              conv.estado === "expirado" ? "text-red-300" :
              conv.estado === "frio" ? "text-blue-300" :
              conv.estado === "demorado" ? "text-orange-300" :
              conv.estado === "pendiente" ? "text-yellow-300" :
              "text-green-300"
            }`}>
              {conv.estadoLabel}
            </p>
            <p className={`text-sm font-bold ${
              conv.estado === "expirado" ? "text-red-400" :
              conv.estado === "frio" ? "text-blue-400" :
              conv.estado === "demorado" ? "text-orange-400" :
              conv.estado === "pendiente" ? "text-yellow-400" :
              "text-green-400"
            }`}>
              {formatearEspera(conv.minutosSinResponder)}
            </p>
            <p className="text-[10px] text-[var(--muted)]">
              {conv.estado === "atendido" ? "desde tu respuesta" : "esperando"}
              {" · "}
              {conv.minutosRestantes <= 0 ? "ventana cerrada" :
               conv.horasRestantes < 1 ? `${conv.minutosRestantes} min de ventana` :
               `${conv.horasRestantes}h de ventana`}
            </p>
          </div>
        </div>
      </div>

      {/* Conversación y respuesta desde el panel (solo Puente Alto: responde Pablo Encina) */}
      {slug === "puente-alto" && conv.leadId && (
        <RespuestaChat
          slug={slug}
          leadId={conv.leadId}
          nombre={conv.contactName}
          programa={conv.pipelineName}
          mensajes={mensajes}
          ventanaAbierta={conv.minutosRestantes > 0}
          configListo={envioListo}
        />
      )}

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
