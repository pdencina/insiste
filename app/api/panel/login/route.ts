/**
 * API Panel: inicio de sesión de sede.
 *
 * POST /api/panel/login  Body: { slug, clave }  →  { ok, token }
 */

import { NextRequest, NextResponse } from "next/server";
import { iniciarSesion } from "@/lib/panel/sesion";

export async function POST(request: NextRequest) {
  try {
    const { slug, clave } = await request.json();
    const token = typeof slug === "string" && typeof clave === "string" ? iniciarSesion(slug, clave) : null;
    if (!token) {
      // Pequeña espera para frenar intentos por fuerza bruta
      await new Promise((r) => setTimeout(r, 800));
      return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 });
    }
    return NextResponse.json({ ok: true, token });
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
}
