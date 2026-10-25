/**
 * Categorización por reglas (sin IA, instantánea, offline).
 * Orden: reglas del usuario (por prioridad) → palabras clave predefinidas → null.
 * La IA (Ollama/Gemini) queda como tercer escalón para lo que esto no resuelva.
 */

export interface CategoryRule {
  pattern: string;
  /** Se conserva por compatibilidad; las reglas nunca se ejecutan como regex. */
  matchType: 'contains' | 'regex';
  categoryId: string;
  priority: number;
}

/** Minúsculas y sin tildes: "Droguería" → "drogueria". */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const BUILTIN_KEYWORDS: { categoryId: string; keywords: string[] }[] = [
  { categoryId: 'cat_comida_domicilio', keywords: ['rappi', 'ifood', 'domicilios', 'uber eats'] },
  { categoryId: 'cat_comida_restaurante', keywords: ['mcdonald', 'kfc', 'burger', 'restaurante', 'frisby', 'crepes', 'juan valdez', 'starbucks', 'pizza', 'sushi'] },
  { categoryId: 'cat_comida_mercado', keywords: ['exito', 'jumbo', 'carulla', 'olimpica', 'd1', 'ara', 'surtimax', 'makro', 'pricesmart', 'plaza de mercado'] },
  { categoryId: 'cat_transporte', keywords: ['uber', 'didi', 'cabify', 'indriver', 'terpel', 'primax', 'texaco', 'transmilenio', 'tu llave', 'peaje', 'parqueadero'] },
  { categoryId: 'cat_servicios', keywords: ['claro', 'movistar', 'tigo', 'etb', 'epm', 'codensa', 'enel', 'vanti', 'acueducto', 'wom'] },
  { categoryId: 'cat_entretenimiento', keywords: ['netflix', 'spotify', 'disney', 'hbo', 'prime video', 'cinemark', 'cine colombia', 'steam', 'playstation', 'xbox'] },
  { categoryId: 'cat_salud', keywords: ['farmacia', 'drogueria', 'cruz verde', 'farmatodo', 'locatel', 'clinica', 'eps', 'odontolog', 'laboratorio'] },
  { categoryId: 'cat_educacion', keywords: ['universidad', 'colegio', 'platzi', 'udemy', 'coursera', 'icfes', 'sena'] },
  { categoryId: 'cat_compras', keywords: ['falabella', 'alkosto', 'ktronix', 'mercadolibre', 'mercado libre', 'amazon', 'temu', 'shein', 'zara', 'homecenter', 'decathlon'] },
  { categoryId: 'cat_vivienda', keywords: ['arriendo', 'administracion', 'inmobiliaria', 'predial'] },
];

// Se compilan una sola vez: palabra completa, para que "ara" no coincida con "para".
const BUILTIN_COMPILED = BUILTIN_KEYWORDS.map((b) => ({
  categoryId: b.categoryId,
  re: new RegExp(`\\b(?:${b.keywords.map((k) => escapeRe(normalizeText(k))).join('|')})`),
}));

/** Devuelve el id de categoría sugerido para un comercio/descripción, o null. */
export function categorize(text: string, rules: CategoryRule[] = []): string | null {
  const t = normalizeText(text);
  if (!t.trim()) return null;

  // Las reglas del usuario SIEMPRE se tratan como texto plano ("contiene"), aunque vengan marcadas
  // como regex: un patrón malicioso (p. ej. importado de un respaldo) podría congelar la app (ReDoS).
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const needle = normalizeText(r.pattern).trim();
    if (needle && needle.length <= 80 && t.includes(needle)) return r.categoryId;
  }
  for (const b of BUILTIN_COMPILED) if (b.re.test(t)) return b.categoryId;
  return null;
}
