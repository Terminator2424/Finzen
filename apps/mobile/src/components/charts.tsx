import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './ui';

/** Barra de progreso. `level` cambia el color: ok = primario, warn = ámbar, over = rojo. */
export function ProgressBar({ ratio, level = 'ok' }: { ratio: number; level?: 'ok' | 'warn' | 'over' }) {
  const { colors } = useTheme();
  const color = level === 'over' ? colors.danger : level === 'warn' ? colors.warning : colors.primary;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

export interface Slice { label: string; value: number }

/** Colores de las porciones: derivados de la paleta + semánticos, para que cambien con el tema. */
function sliceColors(c: ReturnType<typeof useTheme>['colors']) {
  return [c.primary, c.secondary, c.accent, c.warning, c.success, c.textSecondary];
}

/** Gráfico circular (dona) con leyenda. Muestra el top 5 y agrupa el resto en "Otras". */
export function DonutChart({ data, size = 150 }: { data: Slice[]; size?: number }) {
  const { colors } = useTheme();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <AppText color={colors.textSecondary}>Aún no hay gastos este mes.</AppText>;

  const top = data.slice(0, 5);
  const rest = data.slice(5).reduce((s, d) => s + d.value, 0);
  const slices = rest > 0 ? [...top, { label: 'Otras', value: rest }] : top;
  const palette = sliceColors(colors);

  const r = size / 2 - 12;
  const c = size / 2;
  let angle = -Math.PI / 2;
  const paths = slices.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const pt = (a: number) => `${c + r * Math.cos(a)} ${c + r * Math.sin(a)}`;
    // Una porción del 100 % no se puede dibujar con un solo arco: se parte en dos mitades.
    const d = sweep >= Math.PI * 2 - 1e-6
      ? `M ${pt(a0)} A ${r} ${r} 0 1 1 ${pt(a0 + Math.PI)} A ${r} ${r} 0 1 1 ${pt(a0)}`
      : `M ${pt(a0)} A ${r} ${r} 0 ${large} 1 ${pt(a1)}`;
    return <Path key={s.label} d={d} stroke={palette[i % palette.length]} strokeWidth={22} fill="none" />;
  });

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Svg width={size} height={size}>{paths}</Svg>
      <View style={{ flex: 1, gap: 6 }}>
        {slices.map((s, i) => (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette[i % palette.length] }} />
            <AppText variant="caption" style={{ flex: 1 }}>{s.label}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>{Math.round((s.value / total) * 100)}%</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface Point { label: string; value: number }

/** Línea simple (evolución del patrimonio). Necesita al menos 2 puntos. */
export function LineChart({ points, width = 300, height = 130 }: { points: Point[]; width?: number; height?: number }) {
  const { colors } = useTheme();
  if (points.length < 2) {
    return <AppText color={colors.textSecondary}>La gráfica aparecerá cuando tengas al menos 2 meses de historial.</AppText>;
  }
  const pad = 14;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const xy = points.map((p, i) => [
    pad + (i * (width - pad * 2)) / (points.length - 1),
    height - pad - 16 - ((p.value - min) / span) * (height - pad * 2 - 16),
  ] as const);

  return (
    <Svg width={width} height={height}>
      <Polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={colors.primary} strokeWidth={3} />
      {xy.map(([x, y], i) => (
        <G key={points[i]!.label}>
          <Circle cx={x} cy={y} r={4} fill={colors.primary} />
          <SvgText x={x} y={height - 2} fontSize={10} fill={colors.textSecondary} textAnchor="middle">
            {points[i]!.label.slice(5)}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}
