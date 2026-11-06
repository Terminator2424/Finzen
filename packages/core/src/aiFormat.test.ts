import { describe, expect, it } from 'vitest';
import { parseAiText, type AiBlock } from './aiFormat';

const text = (b: AiBlock) => b.spans.map((s) => s.text).join('');

describe('parseAiText', () => {
  it('convierte **negrilla** en un tramo en negrita, sin asteriscos', () => {
    const [b] = parseAiText('Gastaste **$120.000** en comida');
    expect(b!.kind).toBe('paragraph');
    expect(b!.spans).toEqual([
      { text: 'Gastaste ', bold: false }, { text: '$120.000', bold: true }, { text: ' en comida', bold: false },
    ]);
  });
  it('las viñetas con * o - se vuelven bullets', () => {
    const r = parseAiText('* Recorta domicilios\n- Revisa suscripciones');
    expect(r.map((b) => b.kind)).toEqual(['bullet', 'bullet']);
    expect(text(r[0]!)).toBe('Recorta domicilios');
  });
  it('una línea que empieza con **negrilla** no es una viñeta', () => {
    expect(parseAiText('**Resumen:** todo bien')[0]!.kind).toBe('paragraph');
  });
  it('quita los # de los encabezados', () => {
    const [b] = parseAiText('## Presupuesto');
    expect(b!.kind).toBe('heading');
    expect(text(b!)).toBe('Presupuesto');
  });
  it('listas numeradas', () => {
    const [b] = parseAiText('1. Paga la tarjeta');
    expect(b).toMatchObject({ kind: 'number', n: '1' });
    expect(text(b!)).toBe('Paga la tarjeta');
  });
  it('las tablas pasan a texto', () => {
    const r = parseAiText('| Categoría | Total |\n|---|---|\n| Comida | $50.000 |');
    expect(r.map(text)).toEqual(['Categoría · Total', 'Comida · $50.000']);
  });
  it('el texto plano no cambia', () => {
    const r = parseAiText('Vas bien este mes.\n\nTe sobran $200.000.');
    expect(r.map(text)).toEqual(['Vas bien este mes.', 'Te sobran $200.000.']);
  });
});