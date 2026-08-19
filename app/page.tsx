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

type Tab = "inbox" | "borradores" | "seguimientos" | "config";

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
      if (data.ok) setInbox(data.inbox);
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
        <NavItem active={tab === "config"} onClick={() => setTab("config")} icon="⚙️" label="Config" />
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
        <h2 className="text-lg font-semibold">Inbox</h2>
        <button onClick={onRefresh} className="text-sm text-[var(--accent)] hover:underline">Actualizar</button>
      </div>
      {inbox.length === 0 && <p className="text-[var(--muted)] text-sm">No hay correos nuevos</p>}
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
                <span className="text-xs text-[var(--muted)]">{formatDate(msg.date)}</span>
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
  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Configuración</h2>
      <div className="p-4 rounded border border-[var(--border)] bg-[var(--card)]">
        <h3 className="text-sm font-medium mb-3">Cadencia de recordatorios</h3>
        <p className="text-sm text-[var(--muted)]">Días entre cada recordatorio: 1, 3, 7, 12</p>
        <p className="text-xs text-[var(--muted)] mt-2">Editar en Supabase → tabla reglas</p>
      </div>
      <div className="mt-4 p-4 rounded border border-[var(--border)] bg-[var(--card)]">
        <h3 className="text-sm font-medium mb-3">Contactos formales (trato de usted)</h3>
        <ul className="text-sm text-[var(--muted)] space-y-1">
          <li>pburgos@armglobal.org — Mi Pastor</li>
          <li>pbpburgos2@gmail.com — Mi Pastor</li>
          <li>palarcon@armglobal.org — Pastor Alarcón</li>
        </ul>
      </div>
      <div className="mt-4 p-4 rounded border border-[var(--border)] bg-[var(--card)]">
        <h3 className="text-sm font-medium mb-3">Organigrama</h3>
        <ul className="text-sm text-[var(--muted)] space-y-1">
          <li>Pastor Patricio Burgos → Aprueba gastos</li>
          <li>Patricio Andrés Burgos (paburgos) → Ejecuta pagos</li>
          <li>Pablo Encina (pencina) → Campus, presupuestos, plataforma</li>
        </ul>
      </div>
      <div className="mt-4 p-4 rounded border border-[var(--border)] bg-[var(--card)]">
        <h3 className="text-sm font-medium mb-3">Modo actual</h3>
        <p className="text-sm text-[var(--muted)]">Solo borradores (el agente no envía directamente)</p>
        <p className="text-sm text-[var(--muted)] mt-1">Crons: captar c/15min, sincronizar c/10min, enviar c/30min, responder c/5min</p>
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

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return "Hace minutos";
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return date.toLocaleDateString("es-CL", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}
