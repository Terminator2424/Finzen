import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { setSetting } from '../services/repo';
import { PALETTES, type ModePreference, type PaletteId, type ThemeColors } from './palettes';

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
  paletteId: PaletteId;
  mode: ModePreference;
  setPalette: (p: PaletteId) => void;
  setMode: (m: ModePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface Props {
  initialPalette: PaletteId;
  initialMode: ModePreference;
  children: React.ReactNode;
}

export function ThemeProvider({ initialPalette, initialMode, children }: Props) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [paletteId, setPaletteState] = useState<PaletteId>(initialPalette);
  const [mode, setModeState] = useState<ModePreference>(initialMode);

  // La preferencia se guarda en `settings` (scope 'user' → se sincroniza entre dispositivos).
  const setPalette = useCallback((p: PaletteId) => {
    setPaletteState(p);
    void setSetting('palette', p);
  }, []);
  const setMode = useCallback((m: ModePreference) => {
    setModeState(m);
    void setSetting('mode', m);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = mode === 'auto' ? system === 'dark' : mode === 'dark';
    return {
      colors: PALETTES[paletteId][isDark ? 'dark' : 'light'],
      isDark, paletteId, mode, setPalette, setMode,
    };
  }, [paletteId, mode, system, setPalette, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>');
  return ctx;
}
