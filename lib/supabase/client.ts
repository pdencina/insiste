import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase para uso en el servidor (Server Components, Server Actions, Route Handlers).
 * Usa la service role key para bypasear RLS donde sea necesario (crons).
 *
 * Nota: usamos el cliente sin genérico de Database porque los tipos generados
 * requieren `supabase gen types`. Las tablas se tipan con interfaces en types.ts.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Faltan variables de entorno de Supabase (service role)");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Cliente Supabase para uso en el servidor con contexto de usuario autenticado.
 * Respeta RLS usando la anon key.
 */
export function createServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Faltan variables de entorno de Supabase (anon)");
  }

  return createClient(url, key);
}
