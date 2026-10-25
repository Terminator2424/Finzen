import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { groupDigits } from '../utils/format';

/** Componentes base. Todos leen los colores del tema: ninguna pantalla usa colores fijos. */

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>
  );
}

export function AppText({
  children, variant = 'body', color, style,
}: {
  children: React.ReactNode;
  variant?: 'title' | 'subtitle' | 'body' | 'caption' | 'big';
  color?: string;
  style?: object;
}) {
  const { colors } = useTheme();
  const base = { title: 26, subtitle: 18, body: 15, caption: 12, big: 34 }[variant];
  const weight = variant === 'body' || variant === 'caption' ? '400' : '700';
  return <Text style={[{ fontSize: base, fontWeight: weight, color: color ?? colors.text }, style]}>{children}</Text>;
}

export function Button({
  label, onPress, variant = 'primary', disabled,
}: { label: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean }) {
  const { colors } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? colors.primary : 'transparent',
          borderColor: colors.primary,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? colors.onPrimary : colors.primary, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border },
      ]}
    >
      <Text style={{ color: selected ? colors.onPrimary : colors.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="caption" color={colors.textSecondary}>{label}</AppText>
      <TextInput
        placeholderTextColor={colors.textSecondary}
        // Campos secretos: sin autocorrección ni sugerencias del teclado (que podrían aprender la clave).
        {...(props.secureTextEntry ? { autoCorrect: false, autoComplete: 'off', importantForAutofill: 'no', spellCheck: false } : {})}
        {...props}
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
      />
    </View>
  );
}

/** Campo de dinero: muestra "1.250.000" mientras se escribe y entrega el texto crudo con puntos. */
export function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(t) => onChange(groupDigits(t))}
      keyboardType="number-pad"
      placeholder="0"
    />
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  button: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 14, alignItems: 'center' },
  chip: { borderRadius: 20, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 14 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});

/** Encabezado de pantallas secundarias, con botón de volver. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      <Pressable onPress={() => router.back()} accessibilityLabel="Volver" hitSlop={12}>
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }}><AppText variant="title">{title}</AppText></View>
      {right}
    </View>
  );
}

/** Fila "etiqueta ........ valor". */
export function InfoRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <AppText color={colors.textSecondary}>{label}</AppText>
      <AppText color={color}>{value}</AppText>
    </View>
  );
}
