/**
 * Sesión del panel en el navegador: token firmado que entrega /api/panel/login.
 * Si una ruta responde 401 (token vencido o inválido), se cierra la sesión.
 */

const clave = (slug: string) => `sede_token_${slug}`;

export function tokenSede(slug: string): string {
  try {
    return localStorage.getItem(clave(slug)) ?? "";
  } catch {
    return "";
  }
}

export function guardarToken(slug: string, token: string) {
  try {
    localStorage.setItem(clave(slug), token);
    localStorage.removeItem(`sede_${slug}`); // sesión antigua (solo validada en el navegador)
  } catch {
    // Sin almacenamiento: la sesión dura lo que dure la pestaña
  }
}

export function cerrarSesion(slug: string) {
  try {
    localStorage.removeItem(clave(slug));
  } catch {
    // nada
  }
}

/** fetch a una ruta del panel con el token de la sede; ante 401 cierra sesión y recarga. */
export async function fetchSede(slug: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), "x-sede-token": tokenSede(slug) },
  });
  if (res.status === 401) {
    cerrarSesion(slug);
    window.location.reload();
  }
  return res;
}
