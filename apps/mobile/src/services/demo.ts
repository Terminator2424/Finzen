import { getDb } from './db';
import { dateStr } from './receivables';
import { getSetting, setSetting } from './repo';

/**
 * Datos de ejemplo para grabar el video. Todo lleva el prefijo "demo_" en el id, se inserta directo (sin pasar
 * por la cola de sincronización) y se puede quitar sin tocar nada real. Se niega si ya hay datos reales: la demo
 * no se mezcla con tus finanzas.
 */
const SNAP_KEY = 'demo_snapshots';
const DAY = 86_400_000;
const IS_DEMO = "substr(id,1,5) = 'demo_'";
const pad = (n: number) => String(n).padStart(2, '0');

export async function isDemoLoaded(): Promise<boolean> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts WHERE ${IS_DEMO}`);
  return (r?.n ?? 0) > 0;
}

async function realRows(): Promise<number> {
  const db = await getDb();
  let n = 0;
  for (const t of ['accounts', 'transactions', 'debts', 'receivables']) {
    const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE deleted_at IS NULL AND NOT (${IS_DEMO})`);
    n += r?.n ?? 0;
  }
  return n;
}

export async function loadDemo(): Promise<void> {
  if (await isDemoLoaded()) throw new Error('Los datos de ejemplo ya están cargados.');
  if ((await realRows()) > 0) {
    throw new Error('Ya tienes datos reales. Para grabar: haz un respaldo cifrado, usa "Borrar todos los datos", carga la demo y, al terminar, restaura tu respaldo.');
  }
  const db = await getDb();
  const now = Date.now();
  const today = new Date();
  // Los movimientos caen siempre en el mes actual (el día se recorta a hoy).
  const dayAt = (k: number) => new Date(today.getFullYear(), today.getMonth(), Math.min(k, today.getDate()), 12).getTime();
  const run = (sql: string, p: (string | number | null)[]) => db.runAsync(sql, p);
  const months: string[] = [];

  await db.withTransactionAsync(async () => {
    const accounts: [string, string, string, number][] = [
      ['demo_nu', 'Nu', 'savings', 1_250_000], ['demo_nequi', 'Nequi', 'wallet', 180_000], ['demo_efectivo', 'Efectivo', 'cash', 60_000],
    ];
    for (const [id, name, kind, balance] of accounts) {
      await run('INSERT INTO accounts (id,name,kind,balance,currency,last4,archived,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,NULL,0,?,?,NULL)', [id, name, kind, balance, 'COP', now, now]);
    }

    const tx: [number, 'income' | 'expense', number, string, string, string][] = [
      [1, 'income', 2_400_000, 'Salario', 'cat_ingreso_salario', 'demo_nu'],
      [2, 'expense', 1_100_000, 'Arriendo', 'cat_vivienda', 'demo_nu'],
      [3, 'expense', 86_400, 'Éxito', 'cat_comida_mercado', 'demo_nu'],
      [4, 'expense', 23_500, 'Rappi', 'cat_comida_domicilio', 'demo_nequi'],
      [5, 'expense', 9_800, 'Uber', 'cat_transporte', 'demo_nequi'],
      [6, 'expense', 38_900, 'Netflix', 'cat_entretenimiento', 'demo_nu'],
      [8, 'expense', 132_000, 'Internet', 'cat_servicios', 'demo_nu'],
      [9, 'income', 180_000, 'Trabajo freelance', 'cat_ingreso_otros', 'demo_nequi'],
      [10, 'expense', 31_200, 'Farmacia', 'cat_salud', 'demo_efectivo'],
      [12, 'expense', 76_000, 'Zapatos', 'cat_compras', 'demo_nu'],
      [14, 'expense', 18_500, 'Tienda D1', 'cat_comida_mercado', 'demo_nequi'],
      [16, 'expense', 42_000, 'Restaurante', 'cat_comida_restaurante', 'demo_efectivo'],
      [18, 'expense', 12_000, 'Bus', 'cat_transporte', 'demo_efectivo'],
    ];
    let i = 0;
    for (const [day, type, amount, merchant, cat, acct] of tx) {
      i++;
      await run(
        `INSERT INTO transactions (id,account_id,category_id,debt_id,type,amount,merchant,note,occurred_at,source,payment_method,status,dedupe_hash,created_at,updated_at,deleted_at)
         VALUES (?,?,?,NULL,?,?,?,NULL,?,'manual',?,'posted',NULL,?,?,NULL)`,
        [`demo_tx_${i}`, acct, cat, type, amount, merchant, dayAt(day), type === 'income' ? 'unknown' : (acct === 'demo_efectivo' ? 'cash' : 'debit'), now, now],
      );
    }

    const fd = new Date(today.getFullYear(), today.getMonth() + (today.getDate() <= 15 ? 0 : 1), 15);
    const debt = (d: { id: string; name: string; kind: string; provider: string | null; principal: number; balance: number; inst: number | null; monthly: number | null; rate: number; dueDay: number | null; first: string | null; limit: number | null; cut: number | null }) =>
      run(
        `INSERT INTO debts (id,name,kind,provider,principal,balance,installments_total,monthly_payment,monthly_rate,fixed_fee_per_installment,due_day,first_due_date,status,origin_transaction_id,credit_limit,cut_day,parent_debt_id,created_at,updated_at,deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,?,'active',NULL,?,?,NULL,?,?,NULL)`,
        [d.id, d.name, d.kind, d.provider, d.principal, d.balance, d.inst, d.monthly, d.rate, d.dueDay, d.first, d.limit, d.cut, now, now],
      );
    await debt({ id: 'demo_card', name: 'Nu', kind: 'credit_card', provider: 'nu', principal: 350_000, balance: 350_000, inst: null, monthly: null, rate: 0.0208, dueDay: 25, first: null, limit: 2_000_000, cut: 10 });
    await debt({ id: 'demo_prestamo', name: 'Préstamo familiar', kind: 'informal', provider: null, principal: 500_000, balance: 300_000, inst: null, monthly: 100_000, rate: 0, dueDay: 5, first: null, limit: null, cut: null });
    await debt({ id: 'demo_plan', name: 'Addi · Audífonos', kind: 'bnpl', provider: 'addi', principal: 180_000, balance: 180_000, inst: 3, monthly: 60_000, rate: 0, dueDay: 15, first: dateStr(fd), limit: null, cut: null });
    for (let n = 1; n <= 3; n++) {
      const due = dateStr(new Date(fd.getFullYear(), fd.getMonth() + n - 1, 15));
      await run('INSERT INTO debt_installments (id,debt_id,number,due_date,principal,interest,fee,total,paid_at,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,0,0,?,NULL,?,?,NULL)', [`demo_inst_${n}`, 'demo_plan', n, due, 60_000, 60_000, now, now]);
    }

    const owe = 'INSERT INTO receivables (id,debtor,amount,paid,due_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)';
    await run(owe, ['demo_cobro_1', 'Camilo', 80_000, 0, dateStr(new Date(now + 7 * DAY)), 'Almuerzo del viernes', now, now]);
    await run(owe, ['demo_cobro_2', 'Laura', 45_000, 15_000, dateStr(new Date(now - 3 * DAY)), 'Entradas al cine', now, now]);
    await run('INSERT INTO receivable_payments (id,receivable_id,amount,paid_at) VALUES (?,?,?,?)', ['demo_pay_1', 'demo_cobro_2', 15_000, now - 5 * DAY]);

    // Historia del patrimonio para la gráfica (solo meses sin foto real).
    const history: [number, number][] = [[900_000, 820_000], [1_050_000, 790_000], [1_180_000, 760_000], [1_300_000, 720_000], [1_420_000, 680_000]];
    for (let k = 0; k < history.length; k++) {
      const [assets, liabilities] = history[k]!;
      const d = new Date(today.getFullYear(), today.getMonth() - (history.length - k), 1);
      const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      await run('INSERT OR IGNORE INTO net_worth_snapshots (month,assets,liabilities,net,updated_at) VALUES (?,?,?,?,?)', [month, assets, liabilities, assets - liabilities, now]);
      months.push(month);
    }
  });
  await setSetting(SNAP_KEY, JSON.stringify(months), 'device');
}

/** Quita SOLO los datos de ejemplo. */
export async function removeDemo(): Promise<void> {
  const db = await getDb();
  let months: string[] = [];
  try {
    const v = JSON.parse((await getSetting(SNAP_KEY)) ?? '[]');
    if (Array.isArray(v)) months = v.filter((m): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m));
  } catch { /* sin historial de demo */ }
  await db.withTransactionAsync(async () => {
    await db.execAsync(`DELETE FROM receivable_payments WHERE ${IS_DEMO}`);
    await db.execAsync(`DELETE FROM receivables WHERE ${IS_DEMO}`);
    await db.execAsync(`DELETE FROM debt_adjustments WHERE debt_id IN (SELECT id FROM debts WHERE ${IS_DEMO})`);
    await db.execAsync(`DELETE FROM debt_installments WHERE ${IS_DEMO}`);
    await db.execAsync(`DELETE FROM transactions WHERE ${IS_DEMO}`);
    await db.execAsync(`DELETE FROM debts WHERE ${IS_DEMO}`);
    await db.execAsync(`DELETE FROM accounts WHERE ${IS_DEMO}`);
    for (const m of months) await db.runAsync('DELETE FROM net_worth_snapshots WHERE month=?', [m]);
  });
  await setSetting(SNAP_KEY, '[]', 'device');
}