/**
 * ¿El texto de un aviso nombra a esta persona? Nu muestra el nombre enmascarado ("EDI***** JAV*****") y
 * Nequi muestra el nombre completo, a veces con menos palabras ("EDISON GONZALEZ"). Por eso el nombre
 * guardado admite varias versiones separadas por ";" o por salto de línea.
 * Para cada versión se exigen 3 coincidencias (o todas, si tiene menos de 3 palabras): en las palabras
 * enmascaradas se compara el INICIO; en las completas, deben ser idénticas.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function nameTokens(name: string): string[] {
  return [...new Set(norm(name).split(/[^a-z]+/).filter((t) => t.length >= 3))];
}

export function nameVariants(raw: string): string[] {
  return raw.split(/[;\n]+/).map((v) => v.trim()).filter(Boolean);
}

function matchesOne(text: string, fullName: string): boolean {
  const mine = nameTokens(fullName);
  if (mine.length === 0) return false;
  const need = Math.min(3, mine.length);
  const masked: string[] = [];
  const plain = new Set<string>();
  for (const w of norm(text).match(/[a-z]+\*+|[a-z]{3,}/g) ?? []) {
    if (w.endsWith('*')) {
      const prefix = w.replace(/\*+$/, '');
      if (prefix.length >= 3) masked.push(prefix);
    } else {
      plain.add(w);
    }
  }
  let hits = 0;
  for (const t of mine) if (plain.has(t) || masked.some((p) => t.startsWith(p))) hits++;
  return hits >= need;
}

export function mentionsPerson(text: string, names: string): boolean {
  return nameVariants(names).some((v) => matchesOne(text, v));
}