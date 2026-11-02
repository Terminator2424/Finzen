import { AppState } from 'react-native';
import { NotificationListener } from '../../modules/finzen-notifications';
import { getDb } from './db';
import { ensureListenerAlive } from './listenerHealth';
import { ingestNotification } from './notifications';
import { notifyNow } from './reminders';
import { listPending } from './transactions';

/**
 * Puente entre el servicio nativo (Kotlin) y el resto de la app.
 *  - Le entrega al servicio la lista blanca (patrones de apps habilitadas).
 *  - Lee la cola SIN borrarla, la pasa por el pipeline de seguridad y SOLO confirma (ack)
 *    lo ya procesado: si la app se cae a la mitad, no se pierde ninguna notificacion.
 *  - Reengancha el lector si el sistema lo solto.
 * Se ejecuta al abrir la app, al volver a primer plano y cuando llega una notificacion nueva.
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

/** Una notificacion que falla 3 veces se descarta para que no bloquee la cola para siempre. */
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

/** Procesa la cola nativa. Devuelve cuantas transacciones nuevas se importaron. */
export function drainAndIngest(): Promise<number> {
  draining ??= (async () => {
    try {
      const items = NotificationListener.peek();
      if (items.length === 0) return 0;
      const pendingBefore = (await listPending()).length;
      let imported = 0;
      const done: string[] = [];
      for (const n of items) {
        try {
          if ((await ingestNotification(n)) === 'imported') imported++;
          if (n.id) { done.push(n.id); attempts.delete(n.id); }
        } catch (e) {
          console.warn('No se pudo procesar una notificacion', e);
          if (n.id) {
            const k = (attempts.get(n.id) ?? 0) + 1;
            if (k >= MAX_ATTEMPTS) { done.push(n.id); attempts.delete(n.id); } else attempts.set(n.id, k);
          }
        }
      }
      NotificationListener.ack(done);
      const pendingAfter = (await listPending()).length;
      if (pendingAfter > pendingBefore) {
        await notifyNow('Compra a credito detectada', 'Abre FinZen para indicar en cuantas cuotas fue.');
      }
      return imported;
    } finally {
      draining = null;
    }
  })();
  return draining;
}

/** Arranca el puente. Devuelve la funcion para detenerlo. */
export function startListenerBridge(onImported?: () => void): () => void {
  const run = () => {
    drainAndIngest().then((n) => { if (n > 0) onImported?.(); }).catch(() => {});
  };
  const boot = () => { ensureListenerAlive().catch(() => {}); syncWhitelist().then(run).catch(() => {}); };
  boot();
  const sub = NotificationListener.onQueued(run);
  const app = AppState.addEventListener('change', (s) => { if (s === 'active') boot(); });
  return () => { sub.remove(); app.remove(); };
}