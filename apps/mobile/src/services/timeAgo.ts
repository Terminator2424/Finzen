/** "hace 5 min", "hace 2 h"... para mostrar marcas de tiempo del lector. */
export const ago = (t: number): string => {
  if (!t) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
};