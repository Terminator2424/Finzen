/**
 * ¿El texto de un aviso nombra a esta persona? Nu muestra el nombre enmascarado ("EDI***** JAV*****"):
 * se compara el INICIO de cada palabra enmascarada con las palabras del nombre. Si el nombre viene
 * completo, debe ser idéntico. Hacen falta 3 coincidencias (o todas, si el nombre tiene menos de 3 palabras),
 * para que alguien con un nombre parecido no se confunda contigo.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function nameTokens(name: string): string[] {
  return [...new Set(norm(name).split(/[^a-z]+/).filter((t) => t.length >= 3))];
}

export function mentionsPerson(text: string, fullName: string): boolean {
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