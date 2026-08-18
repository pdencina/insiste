/**
 * OAuth 2.0 callback — Intercambia el código por tokens y guarda la cuenta.
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, createOAuth2Client } from "@/lib/gmail/client";
import { createServiceClient } from "@/lib/supabase/client";
import { google } from "googleapis";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  try {
    // 1. Intercambiar código por tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.refresh_token) {
      return NextResponse.redirect(
        new URL("/?error=no_refresh_token", request.url)
      );
    }

    // 2. Obtener el email de la cuenta
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!email) {
      return NextResponse.redirect(
        new URL("/?error=no_email", request.url)
      );
    }

    // 3. Guardar en Supabase
    const supabase = createServiceClient();

    // Cifrar refresh token (fase 1: base64 simple, fase 2: pgcrypto)
    const refreshTokenCifrado = Buffer.from(
      tokens.refresh_token,
      "utf-8"
    ).toString("base64");

    // TODO: Obtener user_id del contexto de auth de Supabase
    // Por ahora usar un placeholder — en producción viene de la sesión
    const userId = "00000000-0000-0000-0000-000000000000";

    const { error: dbError } = await supabase.from("cuentas").upsert(
      {
        user_id: userId,
        email,
        refresh_token_cifrado: refreshTokenCifrado,
        access_token: tokens.access_token,
        access_expira_en: tokens.expiry_date
          ? new Date(tokens.expiry_date).toISOString()
          : null,
        estado: "activa",
        envio_habilitado: false, // Arranca apagado por seguridad
      },
      { onConflict: "user_id,email" }
    );

    if (dbError) {
      console.error("Error guardando cuenta:", dbError);
      return NextResponse.redirect(
        new URL("/?error=db_error", request.url)
      );
    }

    // 4. Crear reglas por defecto si no existen
    await supabase.from("reglas").upsert(
      {
        user_id: userId,
      },
      { onConflict: "user_id" }
    );

    return NextResponse.redirect(new URL("/?connected=true", request.url));
  } catch (err) {
    console.error("Error en OAuth callback:", err);
    return NextResponse.redirect(
      new URL("/?error=oauth_failed", request.url)
    );
  }
}
