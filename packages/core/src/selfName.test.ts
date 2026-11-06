import { describe, expect, it } from 'vitest';
import { mentionsPerson } from './selfName';

const ME = 'Edison Javier Gonzalez Velosa';

describe('mentionsPerson', () => {
  it('reconoce tu nombre enmascarado como lo muestra Nu', () => {
    expect(mentionsPerson('Le enviaste a EDI***** JAV***** GON******* VEL***** en su cuenta', ME)).toBe(true);
  });
  it('no reconoce a otra persona', () => {
    expect(mentionsPerson('Le enviaste a MAR***** CAM***** LOP***** RUI***** en su cuenta', ME)).toBe(false);
  });
  it('3 de 4 palabras alcanzan', () => {
    expect(mentionsPerson('Le enviaste a EDI***** JAV***** GON*******', ME)).toBe(true);
  });
  it('2 de 4 palabras no alcanzan (alguien con nombres parecidos)', () => {
    expect(mentionsPerson('Le enviaste a EDI***** JAV***** GOM*******', ME)).toBe(false);
  });
  it('acepta el nombre completo sin enmascarar', () => {
    expect(mentionsPerson('Transferencia de Edison Javier Gonzalez Velosa', ME)).toBe(true);
  });
  it('ignora tildes y mayúsculas', () => {
    expect(mentionsPerson('LE ENVIASTE A ÉDI***** JAV***** GÓN*******', 'Édison Javier González')).toBe(true);
  });
  it('las palabras comunes no cuentan', () => {
    expect(mentionsPerson('Enviaste $30.000 en su cuenta con tu tarjeta', ME)).toBe(false);
  });
  it('sin nombre guardado no reconoce a nadie', () => {
    expect(mentionsPerson('EDI***** JAV***** GON*******', '')).toBe(false);
  });
});