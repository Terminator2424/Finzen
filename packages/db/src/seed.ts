/**
 * Datos iniciales: categorías predefinidas y lista blanca de apps.
 * Los IDs son fijos ('cat_comida') para que las reglas y los tests no dependan de UUIDs.
 */

export interface SeedCategory {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'expense' | 'income';
}

export const DEFAULT_CATEGORIES: SeedCategory[] = [
  { id: 'cat_comida', name: 'Comida', parentId: null, kind: 'expense' },
  { id: 'cat_comida_domicilio', name: 'Domicilio', parentId: 'cat_comida', kind: 'expense' },
  { id: 'cat_comida_restaurante', name: 'Restaurante', parentId: 'cat_comida', kind: 'expense' },
  { id: 'cat_comida_mercado', name: 'Mercado', parentId: 'cat_comida', kind: 'expense' },
  { id: 'cat_transporte', name: 'Transporte', parentId: null, kind: 'expense' },
  { id: 'cat_vivienda', name: 'Vivienda', parentId: null, kind: 'expense' },
  { id: 'cat_servicios', name: 'Servicios', parentId: null, kind: 'expense' },
  { id: 'cat_entretenimiento', name: 'Entretenimiento', parentId: null, kind: 'expense' },
  { id: 'cat_salud', name: 'Salud', parentId: null, kind: 'expense' },
  { id: 'cat_educacion', name: 'Educación', parentId: null, kind: 'expense' },
  { id: 'cat_compras', name: 'Compras', parentId: null, kind: 'expense' },
  { id: 'cat_deudas', name: 'Pago de deudas', parentId: null, kind: 'expense' },
  { id: 'cat_otros', name: 'Otros', parentId: null, kind: 'expense' },
  { id: 'cat_ingreso_salario', name: 'Salario', parentId: null, kind: 'income' },
  { id: 'cat_ingreso_otros', name: 'Otros ingresos', parentId: null, kind: 'income' },
];

/** SQL de inserción de las categorías predefinidas (idempotente). */
export function seedCategoriesSql(now: number): string {
  const rows = DEFAULT_CATEGORIES.map((c) => {
    const parent = c.parentId ? `'${c.parentId}'` : 'NULL';
    const name = c.name.replace(/'/g, "''");
    return `('${c.id}','${name}',${parent},'${c.kind}',1,${now},${now})`;
  });
  return (
    'INSERT OR IGNORE INTO categories (id,name,parent_id,kind,is_system,created_at,updated_at) VALUES\n' +
    rows.join(',\n') +
    ';'
  );
}
