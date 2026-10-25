/**
 * Paletas de FinZen. Cada paleta tiene modo claro y oscuro con los mismos matices,
 * para que el cambio de modo se sienta continuo. Los colores semánticos
 * (éxito / peligro / advertencia) son iguales en ambas paletas.
 */
export interface ThemeColors {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  textSecondary: string;
  border: string;
  /** Texto sobre el color primario (botones). */
  onPrimary: string;
  success: string;
  danger: string;
  warning: string;
}

export type PaletteId = 'purple' | 'blue';
export type ModePreference = 'light' | 'dark' | 'auto';

const semantic = { success: '#10B981', danger: '#EF4444', warning: '#F59E0B' };

export const PALETTES: Record<PaletteId, { label: string; light: ThemeColors; dark: ThemeColors }> = {
  purple: {
    label: 'Morado',
    light: {
      background: '#FAFAFC', surface: '#FFFFFF', primary: '#7C3AED', secondary: '#A78BFA',
      accent: '#C4B5FD', text: '#1F1B2E', textSecondary: '#6B7280', border: '#E9E5F5',
      onPrimary: '#FFFFFF', ...semantic,
    },
    dark: {
      background: '#0F0A1E', surface: '#1A1230', primary: '#A78BFA', secondary: '#7C3AED',
      accent: '#C4B5FD', text: '#F5F3FF', textSecondary: '#9CA3AF', border: '#2B2147',
      onPrimary: '#0F0A1E', ...semantic,
    },
  },
  blue: {
    label: 'Azul cielo',
    light: {
      background: '#F0F9FF', surface: '#FFFFFF', primary: '#0284C7', secondary: '#38BDF8',
      accent: '#BAE6FD', text: '#0C1B2A', textSecondary: '#6B7280', border: '#D7ECF8',
      onPrimary: '#FFFFFF', ...semantic,
    },
    dark: {
      background: '#0A1520', surface: '#132235', primary: '#38BDF8', secondary: '#0284C7',
      accent: '#BAE6FD', text: '#F0F9FF', textSecondary: '#9CA3AF', border: '#1F3550',
      onPrimary: '#0A1520', ...semantic,
    },
  },
};
