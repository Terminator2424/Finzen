import type { NotificationSource } from './sources';

/**
 * Fuentes SOLO para pruebas. La app real arranca sin fuentes (Modo Aprendizaje).
 * El orden importa: daviplata va antes que davivienda.
 */
export const TEST_SOURCES: NotificationSource[] = [
  { id: 'daviplata', label: 'Daviplata', kind: 'wallet', packagePattern: 'daviplata' },
  { id: 'davivienda', label: 'Davivienda', kind: 'bank', packagePattern: 'davivienda' },
  { id: 'nequi', label: 'Nequi', kind: 'wallet', packagePattern: '^com\\.nequi\\.' },
  { id: 'nu', label: 'Nu', kind: 'bank', packagePattern: '^com\\.nu\\.' },
  { id: 'addi', label: 'Addi', kind: 'bnpl', packagePattern: '^com\\.addi\\.' },
];