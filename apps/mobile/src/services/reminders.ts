import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nextOccurrence, todayString } from '@finzen/core';
import { getDb } from './db';
import { getSetting } from './repo';

const CHANNEL = 'finzen-recordatorios';
/** Tope de avisos programados a la vez. */
const MAX_SCHEDULED = 100;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Recordatorios de pagos', importance: Notifications.AndroidImportance.HIGH,
  });
}

export async function ensurePermission(): Promise<boolean> {
  try {
    await ensureChannel();
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch { return false; }
}

export async function notifyNow(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
    });
  } catch { /* sin permiso */ }
}

const cop = (n: number) => '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Las 9:00 de la fecha, restando `daysBefore` días (0 = el mismo día). */
function at9(dateStr: string, daysBefore: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d - daysBefore, 9, 0, 0);
}

const plusDays = (s: string, n: number): string => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/** Las dos próximas fechas de un día fijo del mes: así hay avisos aunque pase un mes sin abrir la app. */
function nextTwo(dayOfMonth: number): string[] {
  const first = nextOccurrence(todayString(), dayOfMonth);
  return [first, nextOccurrence(plusDays(first, 1), dayOfMonth)];
}

export async function scheduleReconciliationReminder(): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Revisa tus cuentas',
        body: '¿Hiciste compras en Addi, Sistecrédito o con Bre-B? Revisa tus borradores para mantener tu patrimonio al día.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 9, minute: 0, channelId: CHANNEL },
    });
  } catch (e) { console.warn('scheduleReconciliationReminder', e); }
}

/**
 * Reprograma todos los avisos. Para cada pago con fecha (cuotas, tarjetas, gastos fijos y deudas con día de pago)
 * hay un aviso un día antes y otro el mismo día, a las 9:00. Se llama al abrir la app.
 */
export async function rescheduleReminders(): Promise<number> {
  try {
    if (!(await ensurePermission())) return 0;
    await Notifications.cancelAllScheduledNotificationsAsync();

    await scheduleReconciliationReminder();

    const db = await getDb();
    const now = Date.now();
    let count = 0;
    const schedule = async (when: Date, title: string, body: string) => {
      if (when.getTime() <= now || count >= MAX_SCHEDULED) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
      });
      count++;
    };

    // Cuotas de planes (Addi, créditos, compras a cuotas).
    const insts = await db.getAllAsync<{ name: string; due_date: string; total: number; number: number; n: number | null }>(
      `SELECT d.name, i.due_date, i.total, i.number, d.installments_total AS n
         FROM debt_installments i JOIN debts d ON d.id=i.debt_id
        WHERE i.paid_at IS NULL AND i.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active'
        ORDER BY i.due_date LIMIT 30`,
    );
    for (const i of insts) {
      const what = `${i.name}${i.n ? ` (${i.number}/${i.n})` : ''}: ${cop(i.total)}`;
      await schedule(at9(i.due_date, 1), 'Cuota mañana', what);
      await schedule(at9(i.due_date, 0), 'Hoy toca pagar una cuota', what);
    }

    // Tarjetas de crédito con día de pago.
    const cards = await db.getAllAsync<{ name: string; due_day: number | null }>(
      "SELECT name, due_day FROM debts WHERE deleted_at IS NULL AND kind='credit_card' AND status='active' AND due_day IS NOT NULL",
    );
    for (const c of cards) {
      for (const due of nextTwo(c.due_day!)) {
        await schedule(at9(due, 1), 'Pago de tarjeta mañana', `${c.name}: vence el ${due}`);
        await schedule(at9(due, 0), 'Hoy vence tu tarjeta', `${c.name}: vence hoy`);
      }
    }

    // Gastos fijos y suscripciones.
    const recurring = await db.getAllAsync<{ name: string; amount: number; day_of_month: number }>(
      'SELECT name, amount, day_of_month FROM recurring_expenses WHERE is_active=1 AND deleted_at IS NULL',
    );
    for (const r of recurring) {
      for (const due of nextTwo(r.day_of_month)) {
        await schedule(at9(due, 1), 'Pago mañana', `${r.name}: ${cop(r.amount)}`);
        await schedule(at9(due, 0), 'Hoy toca pagar', `${r.name}: ${cop(r.amount)}`);
      }
    }

    // Deudas sin calendario de cuotas (informales y créditos con día de pago).
    const dueDebts = await db.getAllAsync<{ name: string; balance: number; monthly_payment: number | null; due_day: number }>(
      "SELECT name, balance, monthly_payment, due_day FROM debts WHERE deleted_at IS NULL AND status='active' AND kind <> 'credit_card' AND installments_total IS NULL AND due_day IS NOT NULL AND balance > 0",
    );
    for (const d of dueDebts) {
      const amount = cop(d.monthly_payment ?? d.balance);
      for (const due of nextTwo(d.due_day)) {
        await schedule(at9(due, 1), 'Pago mañana', `${d.name}: ${amount}`);
        await schedule(at9(due, 0), 'Hoy toca pagar', `${d.name}: ${amount}`);
      }
    }

    // Cobros: el día en que te toca cobrar, un aviso con quién y cuánto.
    const owed = await db.getAllAsync<{ debtor: string; amount: number; paid: number; due_date: string }>(
      'SELECT debtor, amount, paid, due_date FROM receivables WHERE deleted_at IS NULL AND amount > paid AND due_date IS NOT NULL AND due_date >= ?',
      [todayString()],
    );
    for (const o of owed) await schedule(at9(o.due_date, 0), 'Hoy te toca cobrar', `${o.debtor} te debe ${cop(o.amount - o.paid)}`);

    // Respaldo cifrado: 30 días después del último (o en 7 días si nunca hiciste uno). Si ya se pasó, mañana.
    const lastBackup = Number((await getSetting('last_backup_at')) ?? 0);
    let backupDue = new Date(lastBackup ? lastBackup + 30 * 86_400_000 : now + 7 * 86_400_000);
    if (backupDue.getTime() <= now) backupDue = new Date(now + 86_400_000);
    backupDue.setHours(9, 0, 0, 0);
    await schedule(backupDue, 'Haz un respaldo cifrado', 'Tus datos viven solo en este celular. Exporta un respaldo cifrado desde Ajustes.');
    return count;
  } catch (e) {
    console.warn('rescheduleReminders', e);
    return 0;
  }
}