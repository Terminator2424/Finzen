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
 */

/** Ultimos resultados, visibles en la pantalla de diagnostico. */
export const ingestLog: string[] = [];
function logIngest(line: string) {
  ingestLog.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (ingestLog.length > 30) ingestLog.shift();
}

/** Sincroniza la lista blanca de la base de datos hacia el servicio nativo. */
export async function syncWhitelist(): Promise<void> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ package_pattern: string }>(
    'SELECT package_pattern FROM notification_sources WHERE enabled=1',
  );
  NotificationListener.setWhitelist(rows.map((r) => r.package_pattern));
  logIngest(`lista blanca enviada: ${rows.length} patron(es)`);
}

/** Una notificacion que falla 3 veces se descarta para que no bloquee la cola para siempre. */
const MAX_ATTEMPTS = 3;
const attempts = new Map<string, number>();

/** Una sola pasada sobre la cola nativa. Devuelve cuantas transacciones nuevas se importaron. */
async function processQueue(): Promise<number> {
  const items = NotificationListener.peek();
  if (items.length === 0) return 0;
  logIngest(`cola: ${items.length} pendiente(s)`);
  const pendingBefore = (await listPending()).length;
  let imported = 0;
  const done: string[] = [];
  for (const n of items) {
    try {
      const out = await ingestNotification(n);
      logIngest(`${n.packageName}: ${out}`);
      if (out === 'imported') imported++;
      if (n.id) { done.push(n.id); attempts.delete(n.id); }
    } catch (e) {
      console.warn('No se pudo procesar una notificacion', e);
      logIngest(`${n.packageName}: ERROR ${e instanceof Error ? e.message : String(e)}`);
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
}

let draining: Promise<number> | null = null;
let again = false;

/**
 * Procesa la cola. Si ya hay una pasada en curso NO se pierde la llamada: se anota y se repite
 * al terminar (puede haber llegado una notificacion mientras tanto).
 * Ojo: `draining` se asigna ANTES de que la promesa pueda terminar; limpiarlo dentro de la
 * propia funcion async dejaba la promesa vieja guardada para siempre cuando la cola estaba vacia.
 */
export function drainAndIngest(): Promise<number> {
  if (draining) { again = true; return draining; }
  const p = (async () => {
    let total = 0;
    do {
      again = false;
      total += await processQueue();
    } while (again);
    return total;
  })();
  draining = p;
  const clear = () => { if (draining === p) draining = null; };
  p.then(clear, clear);
  return p;
}

/** Arranca el puente. Devuelve la funcion para detenerlo. */
export function startListenerBridge(onImported?: () => void): () => void {
  const run = () => {
    drainAndIngest()
      .then((n) => { if (n > 0) onImported?.(); })
      .catch((e) => logIngest(`ERROR general: ${e instanceof Error ? e.message : String(e)}`));
  };
  const boot = () => {
    ensureListenerAlive().catch(() => {});
    syncWhitelist().then(run).catch((e) => logIngest(`sync lista blanca ERROR: ${e instanceof Error ? e.message : String(e)}`));
  };
  boot();
  const sub = NotificationListener.onQueued(run);
  const app = AppState.addEventListener('change', (s) => { if (s === 'active') boot(); });
  // Respaldo: si el aviso en vivo del servicio nativo no llega, la cola igual se revisa.
  const poll = setInterval(run, 20_000);
  return () => { sub.remove(); app.remove(); clearInterval(poll); };
}