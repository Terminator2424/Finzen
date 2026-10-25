import { AppState } from 'react-native';
import { NotificationListener } from '../../modules/finzen-notifications';
import { getDb } from './db';
import { ingestNotification } from './notifications';
import { notifyNow } from './reminders';
import { listPending } from './transactions';

/**
 * Puente entre el servicio nativo (Kotlin) y el resto de la app.
 *  - Le entrega al servicio la lista blanca (patrones de apps habilitadas).
 *  - Vacía la cola de notificaciones capturadas y las pasa por el pipeline de seguridad.
 * Se ejecuta al abrir la app, al volver a primer plano y cuando llega una notificación nueva.
 */

/** Sincroniza la lista blanca de la base de datos hacia el servicio nativo. */
export async function syncWhitelist(): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ package_pattern: string }>(
    'SELECT package_pattern FROM notification_sources WHERE enabled=1',
  );
  NotificationListener.setWhitelist(rows.map((r) => r.package_pattern));
}

let draining: Promise<number> | null = null;

/** Procesa la cola nativa. Devuelve cuántas transacciones nuevas se importaron. */
export function drainAndIngest(): Promise<number> {
  draining ??= (async () => {
    try {
      const items = NotificationListener.drain();
      if (items.length === 0) return 0;
      const pendingBefore = (await listPending()).length;
      let imported = 0;
      for (const n of items) {
        try {
          if ((await ingestNotification(n)) === 'imported') imported++;
        } catch (e) {
          console.warn('No se pudo procesar una notificación', e);
        }
      }
      const pendingAfter = (await listPending()).length;
      if (pendingAfter > pendingBefore) {
        await notifyNow('Compra a crédito detectada', 'Abre FinZen para indicar en cuántas cuotas fue.');
      }
      return imported;
    } finally {
      draining = null;
    }
  })();
  return draining;
}

/** Arranca el puente. Devuelve la función para detenerlo. */
export function startListenerBridge(onImported?: () => void): () => void {
  const run = () => {
    drainAndIngest().then((n) => { if (n > 0) onImported?.(); }).catch(() => {});
  };
  syncWhitelist().then(run).catch(() => {});
  const sub = NotificationListener.onQueued(run);
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') { syncWhitelist().then(run).catch(() => {}); }
  });
  return () => { sub.remove(); app.remove(); };
}
