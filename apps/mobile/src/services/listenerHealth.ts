import { requireOptionalNativeModule } from 'expo';

interface Native {
  health(): string;
  requestRebind(): void;
  forceRebind(): void;
  requestIgnoreBattery(): void;
  setPersistentMode(on: boolean): void;
  setSenderBinding(on: boolean): void;
  resetSenderBindings(): void;
  setSenderRules(json: string): void;
}

let native: Native | null = null;
native = requireOptionalNativeModule<Native>('FinzenNotifications');

export interface HealthSnapshot {
  enabled: boolean;
  connected: boolean;
  lastConnected: number;
  lastDisconnected: number;
  lastEvent: number;
  lastQueued: number;
  queued: number;
  ignoringBattery: boolean;
  persistent: boolean;
  senderBinding: boolean;
  learningUntil: number;
  spoofBlocked: number;
  rejectedPatterns: number;
  lastError: string;
  lastErrorAt: number;
  sdk: number;
  manufacturer: string;
}

export function getHealth(): HealthSnapshot | null {
  try { return native ? (JSON.parse(native.health()) as HealthSnapshot) : null; } catch { return null; }
}

export const forceRebind = () => { try { native?.forceRebind(); } catch { /* noop */ } };
export const openBatteryExemption = () => { try { native?.requestIgnoreBattery(); } catch { /* noop */ } };
export const setPersistentMode = (on: boolean) => { try { native?.setPersistentMode(on); } catch { /* noop */ } };
export const setSenderBinding = (on: boolean) => { try { native?.setSenderBinding(on); } catch { /* noop */ } };
export const resetSenderBindings = () => { try { native?.resetSenderBindings(); } catch { /* noop */ } };
export const setSenderRules = (rules: Record<string, string[]>) => { try { native?.setSenderRules(JSON.stringify(rules)); } catch { /* noop */ } };

/** Si el permiso esta dado pero el servicio no esta enlazado: pide rebind y, si no basta, fuerza el toggle del componente. */
export async function ensureListenerAlive(): Promise<void> {
  const h = getHealth();
  if (!h || !h.enabled || h.connected) return;
  try { native?.requestRebind(); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 2500));
  const h2 = getHealth();
  if (h2 && h2.enabled && !h2.connected) forceRebind();
}