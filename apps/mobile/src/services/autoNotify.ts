import * as Notifications from 'expo-notifications';
import { undoAuto, type AutoTx } from './autoLog';
import { getSetting, setSetting } from './repo';
import { formatCOP } from '../utils/format';

const CATEGORY = 'finzen_undo';
export const CONFIRM_KEY = 'confirm_notifications';
const HANDLED_KEY = 'last_undo_handled';

export async function confirmationsOn(): Promise<boolean> {
  return (await getSetting(CONFIRM_KEY)) !== '0';
}

/** Avisa de lo que FinZen registró solo, con botón Deshacer (máximo 3 por pasada). */
export async function announceAuto(items: AutoTx[]): Promise<void> {
  if (items.length === 0 || !(await confirmationsOn())) return;
  for (const t of items.slice(0, 3)) {
    try {
      const body = `${formatCOP(t.amount)}${t.merchant ? ` · ${t.merchant}` : ''}${t.account ? ` · ${t.account}` : ''}`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: t.type === 'income' ? 'Ingreso registrado' : 'Gasto registrado',
          body,
          categoryIdentifier: CATEGORY,
          data: { txId: t.id },
        },
        trigger: null,
      });
    } catch { /* sin permiso de avisos: queda la lista de Inicio */ }
  }
}

async function handleResponse(r: Notifications.NotificationResponse | null | undefined, onDone?: () => void): Promise<void> {
  if (!r || r.actionIdentifier !== 'undo') return;
  const key = r.notification.request.identifier;
  if ((await getSetting(HANDLED_KEY)) === key) return; // la misma respuesta no se atiende dos veces
  await setSetting(HANDLED_KEY, key, 'device');
  const id = (r.notification.request.content.data as { txId?: unknown } | null)?.txId;
  if (typeof id !== 'string') return;
  let ok = false;
  try { ok = await undoAuto(id); } catch { ok = false; }
  Notifications.dismissNotificationAsync(key).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    content: {
      title: ok ? 'Movimiento deshecho' : 'No se pudo deshacer',
      body: ok ? 'Lo quité y devolví el saldo.' : 'Bórralo desde Movimientos.',
    },
    trigger: null,
  }).catch(() => {});
  if (ok) onDone?.();
}

/** Registra el botón "Deshacer" y atiende cuando se toca (también si la app estaba cerrada). */
export function startUndoListener(onDone?: () => void): () => void {
  Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: 'undo', buttonTitle: 'Deshacer', options: { opensAppToForeground: true } },
  ]).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => { handleResponse(r, onDone).catch(() => {}); });
  const N = Notifications as unknown as {
    getLastNotificationResponse?: () => Notifications.NotificationResponse | null;
    getLastNotificationResponseAsync?: () => Promise<Notifications.NotificationResponse | null>;
  };
  try {
    Promise.resolve(N.getLastNotificationResponse ? N.getLastNotificationResponse() : N.getLastNotificationResponseAsync?.())
      .then((r) => handleResponse(r, onDone))
      .catch(() => {});
  } catch { /* sin respuesta pendiente */ }
  return () => sub.remove();
}