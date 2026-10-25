import { requireOptionalNativeModule } from 'expo';

/**
 * Puente al servicio nativo de lectura de notificaciones (solo Android).
 * Si el módulo no existe (iOS, Expo Go, o un APK anterior a este módulo) todas las
 * funciones devuelven valores neutros: la app sigue funcionando sin lectura automática.
 */
interface Native {
  isListenerEnabled(): boolean;
  openListenerSettings(): void;
  openAppSettings(): void;
  setWhitelist(patterns: string[]): void;
  setLearningMode(enabled: boolean): void;
  getSeenPackages(): string;
  clearSeenPackages(): void;
  drainQueue(): string;
  addListener(event: 'onQueued', cb: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<Native>('FinzenNotifications');

export interface QueuedNotification { packageName: string; title: string; text: string; receivedAt: number }
export interface SeenPackage { packageName: string; count: number; last: number }

export const NotificationListener = {
  /** ¿Existe el módulo nativo en este build? */
  available: native != null,
  isEnabled: (): boolean => native?.isListenerEnabled() ?? false,
  openSettings: () => native?.openListenerSettings(),
  openAppSettings: () => native?.openAppSettings(),
  setWhitelist: (patterns: string[]) => native?.setWhitelist(patterns),
  setLearningMode: (on: boolean) => native?.setLearningMode(on),
  clearSeen: () => native?.clearSeenPackages(),
  seenPackages(): SeenPackage[] {
    try {
      const obj = JSON.parse(native?.getSeenPackages() ?? '{}') as Record<string, { count: number; last: number }>;
      return Object.entries(obj)
        .map(([packageName, v]) => ({ packageName, count: v.count, last: v.last }))
        .sort((a, b) => b.last - a.last);
    } catch { return []; }
  },
  drain(): QueuedNotification[] {
    try { return JSON.parse(native?.drainQueue() ?? '[]') as QueuedNotification[]; } catch { return []; }
  },
  onQueued(cb: () => void): { remove(): void } {
    return native?.addListener('onQueued', cb) ?? { remove() {} };
  },
};
