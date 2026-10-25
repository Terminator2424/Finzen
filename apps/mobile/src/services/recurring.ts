import { getDb } from './db';
import { uid, writeRow, softDelete } from './repo';

export interface RecurringExpense {
  id: string;
  name: string;
  amount: number;
  day_of_month: number;
  category_id: string | null;
}

/** Lista todos los gastos fijos activos, ordenados por el día de cobro. */
export async function listRecurring(): Promise<RecurringExpense[]> {
  const db = await getDb();
  return db.getAllAsync<RecurringExpense>(
    'SELECT id, name, amount, day_of_month, category_id FROM recurring_expenses WHERE deleted_at IS NULL AND is_active=1 ORDER BY day_of_month'
  );
}

/** Agrega un nuevo gasto fijo. */
export async function addRecurring(name: string, amount: number, day: number, categoryId: string | null): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(() => writeRow(db, 'recurring_expenses', {
    id: uid(), 
    name, 
    amount, 
    day_of_month: day, 
    category_id: categoryId, 
    is_active: 1,
    created_at: now, 
    updated_at: now, 
    deleted_at: null
  }));
}

/** Elimina un gasto fijo (borrado lógico). */
export async function deleteRecurring(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => softDelete(db, 'recurring_expenses', id));
}

/** Suma total de los gastos fijos del mes para mostrarla en el Dashboard. */
export async function getTotalRecurring(): Promise<number> {
  const db = await getDb();
  const res = await db.getFirstAsync<{ total: number }>(
    'SELECT SUM(amount) as total FROM recurring_expenses WHERE deleted_at IS NULL AND is_active=1'
  );
  return res?.total ?? 0;
}