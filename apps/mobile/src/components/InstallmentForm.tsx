import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { addMonthsClamped, planFromMode, todayString, type RateMode } from '@finzen/core';
import { useTheme } from '../theme/ThemeProvider';
import { formatCOP, parseDigits } from '../utils/format';
import { AppText, Button, Card, Chip, Field, MoneyField } from './ui';

/**
 * Pregunta "¿en cuántas cuotas?" y calcula en vivo cuota, total e intereses.
 * Tres formas de dar el costo (de más fácil a menos): la cuota que ves en tu app,
 * la tasa efectiva anual, o "sin intereses" (con cargo fijo opcional).
 */
export interface InstallmentChoice {
  installments: number;
  mode: RateMode;
  firstDueDate: string;
}

type ModeKind = RateMode['kind'];
const COMMON_N = [2, 3, 6, 9, 12, 18, 24, 36];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  principal: number;
  defaultInstallments?: number | null;
  /** Fecha sugerida de la primera cuota (p. ej. próximo pago de la tarjeta). */
  defaultFirstDue?: string;
  submitLabel: string;
  onSubmit: (c: InstallmentChoice) => void;
}

export function InstallmentForm({ principal, defaultInstallments, defaultFirstDue, submitLabel, onSubmit }: Props) {
  const { colors } = useTheme();
  const [n, setN] = useState(defaultInstallments && defaultInstallments > 1 ? defaultInstallments : 6);
  const [kind, setKind] = useState<ModeKind>('payment');
  const [payment, setPayment] = useState('');
  const [ea, setEa] = useState('');
  const [fee, setFee] = useState('');
  const [due, setDue] = useState(defaultFirstDue ?? addMonthsClamped(todayString(), 1));

  const mode: RateMode | null = useMemo(() => {
    if (kind === 'payment') return parseDigits(payment) > 0 ? { kind, payment: parseDigits(payment) } : null;
    if (kind === 'ea') return { kind, eaPct: Number(ea.replace(',', '.')) || 0 };
    return { kind, feePerInstallment: parseDigits(fee) };
  }, [kind, payment, ea, fee]);

  const preview = useMemo(() => {
    if (!mode || !DATE_RE.test(due) || principal <= 0 || n < 1) return null;
    try { return planFromMode({ principal, installments: n, firstDueDate: due, mode }); } catch { return null; }
  }, [mode, due, principal, n]);

  const validDate = DATE_RE.test(due);

  return (
    <View style={{ gap: 12 }}>
      <AppText variant="subtitle">¿En cuántas cuotas?</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {COMMON_N.map((c) => <Chip key={c} label={`${c}`} selected={n === c} onPress={() => setN(c)} />)}
      </View>
      <Field label="Otro número de cuotas" value={String(n)} keyboardType="number-pad"
        onChangeText={(t) => setN(Math.min(120, parseDigits(t)))} />

      <AppText variant="subtitle">¿Cómo sabes lo que cuesta?</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="Sé la cuota" selected={kind === 'payment'} onPress={() => setKind('payment')} />
        <Chip label="Sé la tasa" selected={kind === 'ea'} onPress={() => setKind('ea')} />
        <Chip label="Sin intereses" selected={kind === 'zero'} onPress={() => setKind('zero')} />
      </View>
      {kind === 'payment' && <MoneyField label="Cuota mensual que te muestra la app (COP)" value={payment} onChange={setPayment} />}
      {kind === 'ea' && (
        <Field label="Tasa efectiva anual %" value={ea} onChangeText={setEa} keyboardType="decimal-pad" placeholder="Ej. 28.5" />
      )}
      {kind === 'zero' && <MoneyField label="Cargo fijo por cuota, si hay (seguro, manejo)" value={fee} onChange={setFee} />}

      <Field label="Fecha de la primera cuota (AAAA-MM-DD)" value={due} onChangeText={setDue} autoCapitalize="none" />
      {!validDate && <AppText variant="caption" color={colors.danger}>Usa el formato 2026-11-15</AppText>}

      {preview && (
        <Card>
          <AppText variant="caption" color={colors.textSecondary}>Resumen del cálculo</AppText>
          <Line label="Cuota mensual" value={formatCOP(preview.summary.firstPayment)} />
          <Line label="Total a pagar" value={formatCOP(preview.summary.totalPaid)} />
          <Line label="Sobrecosto (intereses + cargos)" value={formatCOP(preview.summary.extraCost)} danger={preview.summary.extraCost > 0} />
          {kind !== 'ea' && preview.monthlyRate > 0 && (
            <AppText variant="caption" color={colors.textSecondary}>
              Tasa deducida ≈ {(preview.monthlyRate * 100).toFixed(2)} % mensual ({(((1 + preview.monthlyRate) ** 12 - 1) * 100).toFixed(1)} % E.A.)
            </AppText>
          )}
        </Card>
      )}

      <Button
        label={submitLabel}
        disabled={!preview}
        onPress={() => mode && onSubmit({ installments: n, mode, firstDueDate: due })}
      />
    </View>
  );
}

function Line({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText>{label}</AppText>
      <AppText color={danger ? colors.danger : colors.text}>{value}</AppText>
    </View>
  );
}
