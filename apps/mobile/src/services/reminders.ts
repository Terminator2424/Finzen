import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nextOccurrence, todayString } from '@finzen/core';
import { getDb } from './db';

const CHANNEL = 'finzen-recordatorios';

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

function at9(dateStr: string, daysBefore: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d - daysBefore, 9, 0, 0);
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

export async function rescheduleReminders(): Promise<number> {
  try {
    if (!(await ensurePermission())) return 0;
    await Notifications.cancelAllScheduledNotificationsAsync();
    
    await scheduleReconciliationReminder();

    const db = await getDb();
    const now = Date.now();
    let count = 0;
    const schedule = async (when: Date, title: string, body: string) => {
      if (when.getTime() <= now || count >= 60) return;
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: CHANNEL },
      });
      count++;
    };

    const insts = await db.getAllAsync<{ name: string; due_date: string; total: number; number: number; n: number | null }>(
      `SELECT d.name, i.due_date, i.total, i.number, d.installments_total AS n
         FROM debt_installments i JOIN debts d ON d.id=i.debt_id
        WHERE i.paid_at IS NULL AND i.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active'
        ORDER BY i.due_date LIMIT 40`,
    );
    for (const i of insts) {
      await schedule(at9(i.due_date, 1), 'Cuota mañana', `${i.name}${i.n ? ` (${i.number}/${i.n})` : ''}: ${cop(i.total)}`);
    }

    const cards = await db.getAllAsync<{ name: string; due_day: number | null; balance: number }>(
      "SELECT name, due_day, balance FROM debts WHERE deleted_at IS NULL AND kind='credit_card' AND status='active' AND due_day IS NOT NULL",
    );
    for (const c of cards) {
      const due = nextOccurrence(todayString(), c.due_day!);
      await schedule(at9(due, 2), 'Pago de tarjeta en 2 días', `${c.name}: vence el ${due}`);
    }
    return count;
  } catch (e) {
    console.warn('rescheduleReminders', e);
    return 0;
  }
}