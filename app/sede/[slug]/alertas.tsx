"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MensajeChat } from "./respuesta-chat";

/**
 * Alertas del navegador mientras el panel está abierto (aunque esté en otra pestaña):
 * - Nueva consulta: una familia escribió y espera respuesta
 * - Demorado: lleva más de 30 min esperando
 * - Ventana por cerrar: queda menos de 1 h para poder responder por WhatsApp
 * Cada alerta se muestra una sola vez (se recuerda en el navegador).
 * También pone en el título de la pestaña cuántas familias esperan y suena un aviso corto.
 */

export interface ConvAlerta {
  leadId: number | null;
  contactName: string;
  pipelineName: string | null;
  estado: string;
  minutosRestantes: number;
  lastMessageAt: number;
}

const CLAVE_VISTAS = "insiste_alertas_vistas";
const ESPERANDO = new Set(["pendiente", "demorado", "frio"]);

function leerVistas(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLAVE_VISTAS) ?? "[]"));
  } catch {
    return new Set();
  }
}

function guardarVistas(vistas: Set<string>) {
  try {
    // Solo las últimas 500 para no crecer sin límite
    localStorage.setItem(CLAVE_VISTAS, JSON.stringify([...vistas].slice(-500)));
  } catch {
    // sin almacenamiento: puede repetir alguna alerta, no es grave
  }
}

/** Aviso corto con Web Audio (sin archivos). */
function sonar() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch {
    // el navegador bloquea audio hasta que el usuario interactúa con la página
  }
}

export function useAlertas(
  conversaciones: ConvAlerta[],
  mensajes: Record<number, MensajeChat[]>,
  tituloBase: string
) {
  // Permiso del navegador (en el servidor no existe Notification: se asume "default")
  const permisoNavegador = useSyncExternalStore<NotificationPermission | "no-soportado">(
    () => () => {},
    () => (typeof Notification === "undefined" ? "no-soportado" : Notification.permission),
    () => "default"
  );
  const [permisoPedido, setPermisoPedido] = useState<NotificationPermission | null>(null);
  const permiso = permisoPedido ?? permisoNavegador;
  const primeraCarga = useRef(true);

  useEffect(() => {
    const esperando = conversaciones.filter((c) => ESPERANDO.has(c.estado));
    document.title = esperando.length ? `(${esperando.length}) ${tituloBase}` : tituloBase;

    if (conversaciones.length === 0) return;
    const vistas = leerVistas();
    const nuevas: { clave: string; titulo: string; cuerpo: string; leadId: number | null }[] = [];

    for (const c of conversaciones) {
      if (!c.leadId) continue;
      const ultimo = [...(mensajes[c.leadId] ?? [])].reverse().find((m) => m.tipo === "incoming")?.texto;
      const detalle = ultimo ? `"${ultimo.slice(0, 120)}"` : c.pipelineName ?? "";
      // La clave incluye el último mensaje de la familia: una nueva consulta vuelve a alertar
      const base = `${c.leadId}:${c.lastMessageAt}`;
      if (ESPERANDO.has(c.estado)) {
        nuevas.push({ clave: `${base}:nueva`, titulo: `🔔 Nueva consulta de ${c.contactName}`, cuerpo: detalle, leadId: c.leadId });
      }
      if (c.estado === "demorado" || c.estado === "frio") {
        nuevas.push({ clave: `${base}:demorado`, titulo: `⏰ ${c.contactName} lleva más de 30 min esperando`, cuerpo: detalle, leadId: c.leadId });
      }
      if (ESPERANDO.has(c.estado) && c.minutosRestantes > 0 && c.minutosRestantes <= 60) {
        nuevas.push({
          clave: `${base}:ventana`,
          titulo: `⚠️ Quedan ${c.minutosRestantes} min para responder a ${c.contactName}`,
          cuerpo: "Después se cierra la ventana de 24 h de WhatsApp.",
          leadId: c.leadId,
        });
      }
    }

    const porMostrar = nuevas.filter((n) => !vistas.has(n.clave));
    porMostrar.forEach((n) => vistas.add(n.clave));
    guardarVistas(vistas);

    // En la primera carga solo se registran (no llenar de alertas lo que ya estaba)
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    if (porMostrar.length === 0) return;

    sonar();
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Máximo 3 a la vez; si hay más, un resumen
    const aMostrar = porMostrar.length > 3 ? [{ ...porMostrar[0], titulo: `🔔 ${porMostrar.length} alertas nuevas en el panel`, cuerpo: porMostrar.slice(0, 3).map((n) => n.titulo).join("\n") }] : porMostrar;
    for (const n of aMostrar) {
      const notif = new Notification(n.titulo, { body: n.cuerpo, tag: n.clave, icon: "/favicon.ico" });
      notif.onclick = () => {
        window.focus();
        if (n.leadId) document.getElementById(`conv-${n.leadId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        notif.close();
      };
    }
  }, [conversaciones, mensajes, tituloBase]);

  const activar = async () => {
    if (typeof Notification === "undefined") return;
    const r = await Notification.requestPermission();
    setPermisoPedido(r);
    if (r === "granted") {
      sonar();
      new Notification("🔔 Alertas activadas", { body: "Te avisaré cuando una familia escriba o lleve tiempo esperando.", icon: "/favicon.ico" });
    }
  };

  return { permiso, activar };
}

/** Botón de estado de las alertas para el encabezado del panel. */
export function BotonAlertas({ permiso, activar }: { permiso: NotificationPermission | "no-soportado"; activar: () => void }) {
  if (permiso === "no-soportado") return null;
  if (permiso === "granted") return <span className="text-xs text-green-400" title="Alertas del navegador activadas">🔔 Alertas activas</span>;
  if (permiso === "denied") {
    return (
      <span className="text-xs text-[var(--muted)]" title="Actívalas desde el candado junto a la dirección del sitio → Notificaciones → Permitir">
        🔕 Alertas bloqueadas en el navegador
      </span>
    );
  }
  return (
    <button onClick={activar} className="px-3 py-1 rounded text-xs font-medium bg-yellow-600 hover:bg-yellow-700 text-white">
      🔔 Activar alertas
    </button>
  );
}
