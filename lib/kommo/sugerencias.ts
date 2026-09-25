/**
 * Sugerencia de respuestas predefinidas sin IA (respaldo cuando Gemini no responde)
 * y utilidades comunes al sugeridor y al redactor del panel.
 */

/**
 * Respaldo sin IA: reglas simples por palabras clave sobre el mensaje.
 */
export function sugerirPorPalabras(mensaje: string, contexto?: string): string[] {
  const m = mensaje.toLowerCase();
  const tiene = (...palabras: string[]) => palabras.some((p) => m.includes(p));
  const palabra = (...palabras: string[]) => palabras.some((p) => new RegExp(`(^|[^a-záéíóúñ])${p}([^a-záéíóúñ]|$)`).test(m));
  const edadMatch = m.match(/(\d{1,2})\s*(años|año|anos)/);
  const edad = edadMatch ? parseInt(edadMatch[1], 10) : null;

  const plantillaEdad = (e: number) => (e <= 4 ? "3.1" : e === 5 ? "3.2" : e <= 7 ? "3.3" : e <= 10 ? "3.4" : "3.5");
  const esPlay = (edad !== null && edad <= 4) || tiene("play", "jardín", "jardin") || /play/i.test(contexto ?? "");

  if (palabra("tea", "tdah") || tiene("diagnóstic", "diagnostic", "psicopedag", "necesidad", "autis")) return ["6.3", "6.1"];
  if (palabra("pie")) return ["6.1", "6.2"];
  if (tiene("nadie me", "no me respond", "pésim", "pesim", "molest", "reclamo", "mala atención")) return ["10.1"];
  if (tiene("esposo", "esposa", "pareja", "marido", "conversarlo", "conversar con")) return ["4.3"];
  if (tiene("lejos", "distancia", "traslado")) return ["7.3", "8.1"];
  if (tiene("cuánto", "cuanto", "valor", "precio", "mensualidad", "arancel", "aporte", "costo", "sale")) {
    return edad === null ? [esPlay ? "7.1" : "7.2", "12.1"] : [esPlay ? "7.1" : "7.2", plantillaEdad(edad)];
  }
  if (tiene("reconocid", "mineduc", "ministerio", "valid", "alternativ", "modalidad", "junji")) return ["4.1", "4.4"];
  if (tiene("formulario", "postular", "matricul", "inscrib")) return ["9.1"];
  if (tiene("visita", "conocer", "ir a ver")) return ["8.1", "8.2"];
  if (tiene("de dónde", "de donde", "quién es", "quien es", "quién me", "quien me")) return ["1.4"];
  if (tiene("otro colegio", "ya encontr", "ya lo matricul")) return ["10.2"];
  if (tiene("no me interesa", "no gracias", "no estoy interesad")) return ["10.3"];
  if (edad !== null) return [plantillaEdad(edad), "12.2"];
  return [esPlay ? "1.1" : "1.2", "12.1"];
}

/**
 * Reemplaza [NOMBRE] por el primer nombre del contacto, solo si parece un
 * nombre real (no un usuario de Instagram, email o emojis).
 */
export function completarNombre(texto: string, nombre?: string): string {
  if (!nombre) return texto;
  const primero = nombre.trim().split(/\s+/)[0];
  if (!/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}$/.test(primero)) return texto;
  return texto.replaceAll("[NOMBRE]", primero);
}
