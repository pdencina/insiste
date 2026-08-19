/**
 * API Panel: Config
 *
 * GET: Lee la configuración del agente
 * PUT: Actualiza la configuración del agente
 *
 * La config se guarda como JSON en la tabla reglas (campo metadata via RPC)
 * Para simplicidad, usamos un enfoque key-value en la tabla eventos.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/client";

const CONFIG_KEY = "agent_config";

export interface AgentConfig {
  contactos: Array<{
    email: string;
    nombre: string;
    tratamiento: "formal" | "informal";
    rol: string;
    apodo: string; // Cómo lo llamas en los correos
  }>;
  perfil: {
    nombre: string;
    roles: string[];
    firma: string;
  };
  reglas: {
    cadencia_dias: number[];
    solo_borradores: boolean;
    hora_inicio: string;
    hora_fin: string;
  };
}

const DEFAULT_CONFIG: AgentConfig = {
  contactos: [
    {
      email: "pburgos@armglobal.org",
      nombre: "Pastor Patricio Burgos",
      tratamiento: "formal",
      rol: "Aprueba gastos, autoriza decisiones",
      apodo: "Mi Pastor",
    },
    {
      email: "pbpburgos2@gmail.com",
      nombre: "Pastor Patricio Burgos",
      tratamiento: "formal",
      rol: "Aprueba gastos, autoriza decisiones",
      apodo: "Mi Pastor",
    },
    {
      email: "palarcon@armglobal.org",
      nombre: "Pastora Alarcón",
      tratamiento: "formal",
      rol: "Pastora principal",
      apodo: "Mi Pastora",
    },
    {
      email: "paburgos@armglobal.org",
      nombre: "Patricio Andrés Burgos",
      tratamiento: "informal",
      rol: "Ejecuta pagos y transferencias",
      apodo: "Pato Andrés",
    },
  ],
  perfil: {
    nombre: "Pablo Encina",
    roles: [
      "Pastor de Campus ARM Puente Alto",
      "Apoyo en Fundación Educacional AR Ministries (ARM GLOBAL)",
      "Manejo de presupuestos",
      "Responsable plataforma app.arschoolglobal.com",
    ],
    firma: "Saludos, Pablo",
  },
  reglas: {
    cadencia_dias: [1, 3, 7, 12],
    solo_borradores: true,
    hora_inicio: "08:00",
    hora_fin: "19:00",
  },
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // Buscar config guardada en eventos con accion = CONFIG_KEY
  const { data } = await supabase
    .from("eventos")
    .select("detalle")
    .eq("accion", CONFIG_KEY)
    .order("creado_en", { ascending: false })
    .limit(1)
    .single();

  const config: AgentConfig = data?.detalle ?? DEFAULT_CONFIG;

  return NextResponse.json({ ok: true, config });
}

export async function PUT(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const config = body.config as AgentConfig;

    // Obtener user_id de la cuenta activa
    const { data: cuenta } = await supabase
      .from("cuentas")
      .select("user_id")
      .eq("estado", "activa")
      .limit(1)
      .single();

    if (!cuenta) {
      return NextResponse.json({ error: "No hay cuenta activa" }, { status: 400 });
    }

    // Guardar config como evento
    await supabase.from("eventos").insert({
      user_id: cuenta.user_id,
      accion: CONFIG_KEY,
      detalle: config,
    });

    return NextResponse.json({ ok: true, message: "Configuración guardada" });
  } catch (err) {
    console.error("Error guardando config:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
