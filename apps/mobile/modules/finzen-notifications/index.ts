import { requireOptionalNativeModule } from 'expo';

interface Native {
  isListenerEnabled(): boolean;
  openListenerSettings(): void;
  openAppSettings(): void;
  setWhitelist(patterns: string[]): void;
  setLearningMode(enabled: boolean): void;
  getSeenPackages(): string;
  clearSeenPackages(): void;
  drainQueue(): string;
  /** Solo existen en APK nuevos; con uno viejo se usa drainQueue. */
  peekQueue?(): string;
  ackQueue?(ids: string[]): void;
  stopForegroundService(): void;
  addListener(event: 'onQueued', cb: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<Native>('FinzenNotifications');

export interface QueuedNotification {
  id?: string;
  packageName: string;
  title: string;
  text: string;
  receivedAt: number;
  senderKey?: string;
}
export interface SeenPackage { packageName: string; count: number; last: number }

function readQueue(): QueuedNotification[] {
  try {
    const raw = native?.peekQueue ? native.peekQueue() : native?.drainQueue();
    return JSON.parse(raw ?? '[]') as QueuedNotification[];
  } catch {
    return [];
  }
}

export const NotificationListener = {
  available: native != null,
  isEnabled: (): boolean => native?.isListenerEnabled() ?? false,
  openSettings: () => native?.openListenerSettings(),
  openAppSettings: () => native?.openAppSettings(),
  setWhitelist: (patterns: string[]) => native?.setWhitelist(patterns),
  setLearningMode: (on: boolean) => native?.setLearningMode(on),
  clearSeen: () => native?.clearSeenPackages(),
  stopForegroundService: () => native?.stopForegroundService(),
  seenPackages(): SeenPackage[] {
    try {
      const obj = JSON.parse(native?.getSeenPackages() ?? '{}') as Record<string, { count: number; last: number }>;
      return Object.entries(obj)
        .map(([packageName, v]) => ({ packageName, count: v.count, last: v.last }))
        .sort((a, b) => b.last - a.last);
    } catch { return []; }
  },
  /** Lee la cola SIN borrarla (APK nuevo). Confirma con ack() lo ya importado. */
  peek: (): QueuedNotification[] => readQueue(),
  ack(ids: string[]): void {
    if (ids.length === 0) return;
    try { native?.ackQueue?.(ids); } catch { /* noop */ }
  },
  /** Compatibilidad: lee y borra. */
  drain: (): QueuedNotification[] => readQueue(),
  onQueued(cb: () => void): { remove(): void } {
    return native?.addListener('onQueued', cb) ?? { remove() {} };
  },
};