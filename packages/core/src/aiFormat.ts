/**
 * Las IA responden en Markdown, pero el chat del celular muestra texto. Este módulo convierte la respuesta
 * en bloques simples (párrafo, encabezado, viñeta, número) con tramos en negrita, sin asteriscos ni #.
 */
export interface AiSpan { text: string; bold: boolean }
export type AiBlock =
  | { kind: 'paragraph'; spans: AiSpan[] }
  | { kind: 'heading'; spans: AiSpan[] }
  | { kind: 'bullet'; spans: AiSpan[] }
  | { kind: 'number'; n: string; spans: AiSpan[] };

function inline(text: string): AiSpan[] {
  const clean = text.replace(/`+/g, '');
  const spans: AiSpan[] = [];
  const re = /(\*\*|__)(.+?)\1/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m.index > last) spans.push({ text: clean.slice(last, m.index), bold: false });
    spans.push({ text: m[2]!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < clean.length) spans.push({ text: clean.slice(last), bold: false });
  return spans.map((s) => ({ ...s, text: s.text.replace(/\*+/g, '') })).filter((s) => s.text.length > 0);
}

export function parseAiText(raw: string): AiBlock[] {
  const blocks: AiBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push({ kind: 'paragraph', spans: inline(para.join(' ')) }); para = []; }
  };
  for (const original of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const line = original.trim();
    if (!line || /^```/.test(line) || /^[-*_]{3,}$/.test(line)) { flush(); continue; }
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) { flush(); continue; } // separador de tabla
    const row = /^\|(.+)\|$/.exec(line);
    if (row) {
      flush();
      const cells = row[1]!.split('|').map((c) => c.trim()).filter(Boolean);
      blocks.push({ kind: 'paragraph', spans: inline(cells.join(' · ')) });
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) { flush(); blocks.push({ kind: 'heading', spans: inline(heading[1]!) }); continue; }
    const bullet = /^[*\-•]\s+(.+)$/.exec(line);
    if (bullet) { flush(); blocks.push({ kind: 'bullet', spans: inline(bullet[1]!) }); continue; }
    const num = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (num) { flush(); blocks.push({ kind: 'number', n: num[1]!, spans: inline(num[2]!) }); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}