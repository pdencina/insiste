"use client";

import { useState, useEffect, useCallback } from "react";

// Types
interface InboxMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  hasAttachments: boolean;
  diasSinResponder?: number;
  participantes?: number;
}

interface Borrador {
  draftId: string;
  messageId: string;
  threadId: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
}

interface Seguimiento {
  id: string;
  thread_id: string;
  asunto: string;
  destinatarios: string[];
  estado: string;
  intentos: number;
  proximo_intento: string | null;
  ultimo_envio_propio: string;
  motivo_pausa: string | null;
}

type Tab = "inbox" | "borradores" | "seguimientos" | "whatsapp" | "config";

export default function Panel() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<Tab>("inbox");
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");

  // Data
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [seguimientos, setSeguimientos] = useState<Seguimiento[]>([]);

  // Auth check — use stored token
  useEffect(() => {
    const stored = localStorage.getItem("insiste_token");
    if (stored) {
      setToken(stored);
      setAuthenticated(true);
    }
  }, []);

  const login = () => {
    localStorage.setItem("insiste_token", token);
    setAuthenticated(true);
  };

  const headers = useCallback(() => ({
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  }), [token]);

  // Fetch data based on tab
  useEffect(() => {
    if (!authenticated) return;
    if (tab === "inbox") fetchInbox();
    if (tab === "borradores") fetchBorradores();
    if (tab === "seguimientos") fetchSeguimientos();
  }, [tab, authenticated]);

  const fetchInbox = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/panel/inbox", { headers: headers() });
      const data = await res.json();
      if (data.ok) {
        // Map lastDate to date for compatibility
        const mapped = (data.inbox ?? []).map((msg: Record<string, unknown>) => ({
          ...msg,
          date: msg.lastDate || msg.date || "",
        }));
        setInbox(mapped);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchBorradores = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/panel/borradores", { headers: headers() });
      const data = await res.json();
      if (data.ok) setBorradores(data.borradores);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const fetchSeguimientos = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/panel/seguimientos", { headers: headers() });
      const data = await res.json();
      if (data.ok) setSeguimientos(data.seguimientos);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const ejecutarAccion = async (accion: string, params: Record<string, string>) => {
    setMensaje("");
    try {
      const res = await fetch("/api/panel/acciones", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ accion, ...params }),
      });
      const data = await res.json();
      setMensaje(data.message || data.error || "Hecho");
      // Refresh current tab
      if (tab === "borradores") fetchBorradores();
      if (tab === "seguimientos") fetchSeguimientos();
    } catch (err) {
      setMensaje("Error: " + String(err));
    }
  };

  // Login screen
  if (!authenticated) {
    return (
      <div className="flex items-center justify-center w-full min-h-screen">
        <div className="p-8 rounded-lg border border-[var(--border)] bg-[var(--card)] w-full max-w-sm">
          <h1 className="text-xl font-bold mb-4">Insiste</h1>
          <p className="text-sm text-[var(--muted)] mb-4">Ingresa tu token de acceso</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            placeholder="CRON_SECRET"
            className="w-full p-3 rounded bg-[var(--background)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]"
          />
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

  return (
    <div className="flex w-full min-h-screen">
      {/* Sidebar */}
      <nav className="w-56 border-r border-[var(--border)] p-4 flex flex-col gap-1">
        <h1 className="text-lg font-bold mb-6 px-3">Insiste</h1>
        <NavItem active={tab === "inbox"} onClick={() => setTab("inbox")} icon="📥" label="Inbox" />
        <NavItem active={tab === "borradores"} onClick={() => setTab("borradores")} icon="📝" label="Borradores" />
        <NavItem active={tab === "seguimientos"} onClick={() => setTab("seguimientos")} icon="🔄" label="Seguimientos" />
        <NavItem active={tab === "whatsapp"} onClick={() => setTab("whatsapp")} icon="💬" label="WhatsApp" />
        <NavItem active={tab === "config"} onClick={() => setTab("config")} icon="⚙️" label="Config" />
        <div className="mt-auto pt-4 border-t border-[var(--border)]">
          <a
            href="/api/auth/login"
            className="flex items-center gap-3 px-3 py-2 rounded text-sm text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)] transition-colors"
          >
            <span>🔗</span>
            <span>Conectar Gmail</span>
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        {/* Toast message */}
        {mensaje && (
          <div className="mb-4 p-3 rounded bg-[var(--card)] border border-[var(--border)] text-sm">
            {mensaje}
            <button onClick={() => setMensaje("")} className="ml-4 text-[var(--muted)] hover:text-white">✕</button>
          </div>
        )}

        {loading && <p className="text-[var(--muted)] text-sm">Cargando...</p>}

        {tab === "inbox" && !loading && (
          <InboxView inbox={inbox} onAction={ejecutarAccion} onRefresh={fetchInbox} />
        )}
        {tab === "borradores" && !loading && (
          <BorradoresView borradores={borradores} onAction={ejecutarAccion} onRefresh={fetchBorradores} />
        )}
        {tab === "seguimientos" && !loading && (
          <SeguimientosView seguimientos={seguimientos} onAction={ejecutarAccion} onRefresh={fetchSeguimientos} />
        )}
        {tab === "whatsapp" && (
          <WhatsAppView token={token} />
        )}
        {tab === "config" && (
          <ConfigView />
        )}
      </main>
    </div>
  );
}

// --- Components ---

function NavItem({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
        active ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-white hover:bg-[var(--card-hover)]"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function InboxView({ inbox, onAction, onRefresh }: { inbox: InboxMessage[]; onAction: (a: string, p: Record<string, string>) => void; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Pendientes de respuesta</h2>
          <p className="text-xs text-[var(--muted)]">Correos donde no has sido el último en responder</p>
        </div>
        <button onClick={onRefresh} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>
      {inbox.length === 0 && <p className="text-[var(--muted)] text-sm">No hay correos pendientes de respuesta</p>}
      <div className="flex flex-col gap-2">
        {inbox.map((msg) => (
          <div key={msg.id} className={`p-4 rounded border border-[var(--border)] bg-[var(--card)] hover:bg-[var(--card-hover)] transition-colors ${msg.unread ? "border-l-2 border-l-[var(--accent)]" : ""}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium truncate">{msg.from}</span>
                  {msg.hasAttachments && <span className="text-xs">📎</span>}
                </div>
                <p className="text-sm font-medium truncate">{msg.subject}</p>
                <p className="text-xs text-[var(--muted)] truncate mt-1">{msg.snippet}</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className={`text-xs font-medium ${getDaysColor(msg.date)}`}>{formatDate(msg.date)}</span>
                <div className="flex gap-1">
                  <ActionButton label="Responder IA" onClick={() => onAction("responder", { threadId: msg.threadId })} color="accent" />
                  <ActionButton label="Seguir" onClick={() => onAction("seguir", { threadId: msg.threadId })} color="success" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BorradoresView({ borradores, onAction, onRefresh }: { borradores: Borrador[]; onAction: (a: string, p: Record<string, string>) => void; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Borradores del Agente</h2>
        <button onClick={onRefresh} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>
      {borradores.length === 0 && <p className="text-[var(--muted)] text-sm">No hay borradores pendientes</p>}
      <div className="flex flex-col gap-3">
        {borradores.map((draft) => (
          <div key={draft.draftId} className="p-4 rounded border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--muted)]">Para: {draft.to}</p>
                <p className="text-sm font-medium mt-1">{draft.subject}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <ActionButton label="Enviar" onClick={() => onAction("enviar_borrador", { draftId: draft.draftId })} color="success" />
                <ActionButton label="Descartar" onClick={() => onAction("descartar_borrador", { draftId: draft.draftId })} color="danger" />
              </div>
            </div>
            <div className="mt-3 p-3 rounded bg-[var(--background)] text-sm whitespace-pre-wrap leading-relaxed">
              {draft.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SeguimientosView({ seguimientos, onAction, onRefresh }: { seguimientos: Seguimiento[]; onAction: (a: string, p: Record<string, string>) => void; onRefresh: () => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Seguimientos Activos</h2>
        <button onClick={onRefresh} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>
      {seguimientos.length === 0 && <p className="text-[var(--muted)] text-sm">No hay seguimientos activos</p>}
      <div className="flex flex-col gap-2">
        {seguimientos.map((seg) => (
          <div key={seg.id} className="p-4 rounded border border-[var(--border)] bg-[var(--card)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{seg.asunto}</p>
                <p className="text-xs text-[var(--muted)] mt-1">
                  Para: {seg.destinatarios.join(", ")}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span className={`px-2 py-0.5 rounded ${seg.estado === "activo" ? "bg-green-900/30 text-green-400" : "bg-yellow-900/30 text-yellow-400"}`}>
                    {seg.estado}
                  </span>
                  <span className="text-[var(--muted)]">Intentos: {seg.intentos}</span>
                  {seg.proximo_intento && (
                    <span className="text-[var(--muted)]">Próximo: {formatDate(seg.proximo_intento)}</span>
                  )}
                  {seg.motivo_pausa && (
                    <span className="text-yellow-400">{seg.motivo_pausa}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {seg.estado === "activo" ? (
                  <ActionButton label="Pausar" onClick={() => onAction("pausar", { seguimientoId: seg.id })} color="warning" />
                ) : (
                  <ActionButton label="Reanudar" onClick={() => onAction("reanudar", { seguimientoId: seg.id })} color="success" />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigView() {
  const [config, setConfig] = useState<{
    contactos: Array<{ email: string; nombre: string; tratamiento: string; rol: string; apodo: string }>;
    perfil: { nombre: string; roles: string[]; firma: string };
    reglas: { cadencia_dias: number[]; solo_borradores: boolean; hora_inicio: string; hora_fin: string };
  } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("insiste_token");
    fetch("/api/panel/config", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => { if (data.ok) setConfig(data.config); });
  }, []);

  const guardar = async () => {
    setGuardando(true);
    setMsg("");
    try {
      const token = localStorage.getItem("insiste_token");
      const res = await fetch("/api/panel/config", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg("Configuración guardada correctamente");
      } else {
        setMsg("Error: " + (data.error || "No se pudo guardar"));
      }
    } catch (err) {
      setMsg("Error de red: " + String(err));
    }
    setGuardando(false);
    setTimeout(() => setMsg(""), 5000);
  };

  const updateContacto = (idx: number, field: string, value: string) => {
    if (!config) return;
    const contactos = [...config.contactos];
    contactos[idx] = { ...contactos[idx], [field]: value };
    setConfig({ ...config, contactos });
  };

  const addContacto = () => {
    if (!config) return;
    setConfig({
      ...config,
      contactos: [...config.contactos, { email: "", nombre: "", tratamiento: "informal", rol: "", apodo: "" }],
    });
  };

  const removeContacto = (idx: number) => {
    if (!config) return;
    const contactos = config.contactos.filter((_, i) => i !== idx);
    setConfig({ ...config, contactos });
  };

  if (!config) return <p className="text-[var(--muted)] text-sm">Cargando config...</p>;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Configuraci&oacute;n del Agente</h2>
        <button
          onClick={guardar}
          disabled={guardando}
          className="px-4 py-2 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {guardando ? "Guardando..." : "Guardar"}
        </button>
      </div>
      {msg && <p className="text-sm text-green-400 mb-4">{msg}</p>}

      {/* Perfil */}
      <div className="p-4 rounded border border-[var(--border)] bg-[var(--card)] mb-4">
        <h3 className="text-sm font-medium mb-3">Tu perfil</h3>
        <div className="space-y-2">
          <input
            value={config.perfil.nombre}
            onChange={(e) => setConfig({ ...config, perfil: { ...config.perfil, nombre: e.target.value } })}
            placeholder="Tu nombre"
            className="w-full p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm"
          />
          <input
            value={config.perfil.firma}
            onChange={(e) => setConfig({ ...config, perfil: { ...config.perfil, firma: e.target.value } })}
            placeholder="Firma (ej: Saludos, Pablo)"
            className="w-full p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm"
          />
          <textarea
            value={config.perfil.roles.join("\n")}
            onChange={(e) => setConfig({ ...config, perfil: { ...config.perfil, roles: e.target.value.split("\n").filter(Boolean) } })}
            placeholder="Roles (uno por l&iacute;nea)"
            rows={4}
            className="w-full p-2 rounded bg-[var(--background)] border border-[var(--border)] text-sm"
          />
        </div>
      </div>

      {/* Contactos */}
      <div className="p-4 rounded border border-[var(--border)] bg-[var(--card)] mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Contactos</h3>
          <button onClick={addContacto} className="text-xs text-[var(--accent)] hover:underline">+ Agregar</button>
        </div>
        <div className="space-y-3">
          {config.contactos.map((c, idx) => (
            <div key={idx} className="p-3 rounded bg-[var(--background)] border border-[var(--border)] space-y-2">
              <div className="flex gap-2">
                <input
                  value={c.email}
                  onChange={(e) => updateContacto(idx, "email", e.target.value)}
                  placeholder="email@ejemplo.com"
                  className="flex-1 p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-xs placeholder-[var(--muted)]"
                />
                <select
                  value={c.tratamiento}
                  onChange={(e) => updateContacto(idx, "tratamiento", e.target.value)}
                  className="p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-xs"
                >
                  <option value="formal">Usted</option>
                  <option value="informal">T&uacute;</option>
                </select>
                <button onClick={() => removeContacto(idx)} className="text-red-400 text-xs hover:text-red-300">Eliminar</button>
              </div>
              <div className="flex gap-2">
                <input
                  value={c.nombre}
                  onChange={(e) => updateContacto(idx, "nombre", e.target.value)}
                  placeholder="Nombre completo"
                  className="flex-1 p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-xs placeholder-[var(--muted)]"
                />
                <input
                  value={c.apodo}
                  onChange={(e) => updateContacto(idx, "apodo", e.target.value)}
                  placeholder="C&oacute;mo lo llamas (ej: Mi Pastor)"
                  className="flex-1 p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-xs placeholder-[var(--muted)]"
                />
              </div>
              <input
                value={c.rol}
                onChange={(e) => updateContacto(idx, "rol", e.target.value)}
                placeholder="Rol (ej: Aprueba gastos, Ejecuta pagos)"
                className="w-full p-1.5 rounded bg-[var(--card)] border border-[var(--border)] text-xs placeholder-[var(--muted)]"
              />
              <div className="flex gap-4 text-[10px] text-[var(--muted)] pt-1">
                <span>Email</span>
                <span>|</span>
                <span>Trato</span>
                <span>|</span>
                <span>Nombre / Apodo</span>
                <span>|</span>
                <span>Rol en la org</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reglas */}
      <div className="p-4 rounded border border-[var(--border)] bg-[var(--card)]">
        <h3 className="text-sm font-medium mb-3">Reglas</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted)] w-40">Cadencia (d&iacute;as):</label>
            <input
              value={config.reglas.cadencia_dias.join(", ")}
              onChange={(e) => setConfig({ ...config, reglas: { ...config.reglas, cadencia_dias: e.target.value.split(",").map((n) => parseInt(n.trim())).filter(Boolean) } })}
              className="flex-1 p-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted)] w-40">Solo borradores:</label>
            <input
              type="checkbox"
              checked={config.reglas.solo_borradores}
              onChange={(e) => setConfig({ ...config, reglas: { ...config.reglas, solo_borradores: e.target.checked } })}
            />
            <span className="text-xs text-[var(--muted)]">{config.reglas.solo_borradores ? "S&iacute; (reviso antes de enviar)" : "No (env&iacute;a directo)"}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--muted)] w-40">Horario:</label>
            <input
              value={config.reglas.hora_inicio}
              onChange={(e) => setConfig({ ...config, reglas: { ...config.reglas, hora_inicio: e.target.value } })}
              className="w-20 p-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-xs"
            />
            <span className="text-xs text-[var(--muted)]">a</span>
            <input
              value={config.reglas.hora_fin}
              onChange={(e) => setConfig({ ...config, reglas: { ...config.reglas, hora_fin: e.target.value } })}
              className="w-20 p-1.5 rounded bg-[var(--background)] border border-[var(--border)] text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, color }: { label: string; onClick: () => void; color: "accent" | "success" | "warning" | "danger" }) {
  const colors = {
    accent: "bg-blue-600 hover:bg-blue-700",
    success: "bg-green-600 hover:bg-green-700",
    warning: "bg-yellow-600 hover:bg-yellow-700",
    danger: "bg-red-600 hover:bg-red-700",
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-xs text-white font-medium transition-colors ${colors[color]}`}
    >
      {label}
    </button>
  );
}

function WhatsAppView({ token }: { token: string }) {
  const [conversaciones, setConversaciones] = useState<Array<{
    id: number;
    contactName: string;
    leadName: string | null;
    sede: string | null;
    horasRestantes: number;
    minutosRestantes: number;
    estado: string;
    origin: string;
    isRead: boolean;
  }>>([]);
  const [resumen, setResumen] = useState<{ total: number; expirados: number; criticos: number; alertas: number; ok: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/panel/whatsapp", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setConversaciones(data.conversaciones);
        setResumen(data.resumen);
      } else {
        setError(data.error || "Error al cargar");
      }
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  // Auto-refresh cada 60 segundos
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="text-[var(--muted)] text-sm">Cargando conversaciones de Kommo...</p>;
  if (error) return <p className="text-red-400 text-sm">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Ventana 24h WhatsApp</h2>
          <p className="text-xs text-[var(--muted)]">Conversaciones abiertas en Kommo - se actualiza cada 60s</p>
        </div>
        <button onClick={fetchData} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="p-3 rounded border border-red-800 bg-red-950/30 text-center">
            <p className="text-2xl font-bold text-red-400">{resumen.expirados}</p>
            <p className="text-xs text-red-300">Expirados</p>
          </div>
          <div className="p-3 rounded border border-orange-800 bg-orange-950/30 text-center">
            <p className="text-2xl font-bold text-orange-400">{resumen.criticos}</p>
            <p className="text-xs text-orange-300">Criticos (&lt;2h)</p>
          </div>
          <div className="p-3 rounded border border-yellow-800 bg-yellow-950/30 text-center">
            <p className="text-2xl font-bold text-yellow-400">{resumen.alertas}</p>
            <p className="text-xs text-yellow-300">Alerta (&lt;6h)</p>
          </div>
          <div className="p-3 rounded border border-green-800 bg-green-950/30 text-center">
            <p className="text-2xl font-bold text-green-400">{resumen.ok}</p>
            <p className="text-xs text-green-300">OK (&gt;6h)</p>
          </div>
        </div>
      )}

      {/* Lista de conversaciones */}
      {conversaciones.length === 0 && <p className="text-[var(--muted)] text-sm">No hay conversaciones abiertas</p>}
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{conv.contactName}</span>
                  {!conv.isRead && <span className="w-2 h-2 rounded-full bg-blue-400"></span>}
                </div>
                {conv.leadName && (
                  <p className="text-xs text-[var(--muted)] mt-0.5">{conv.leadName}</p>
                )}
                {conv.sede && (
                  <p className="text-[10px] mt-0.5 px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300 inline-block">{conv.sede}</p>
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
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Hace minutos";
    if (hours < 24) return `Hace ${hours}h`;
    if (days === 1) return "Ayer";
    if (days < 7) return `Hace ${days} días`;
    return date.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

function getDaysColor(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (days >= 7) return "text-red-400"; // Urgente
    if (days >= 3) return "text-yellow-400"; // Atención
    if (days >= 1) return "text-orange-300"; // Normal
    return "text-[var(--muted)]"; // Reciente
  } catch {
    return "text-[var(--muted)]";
  }
}
