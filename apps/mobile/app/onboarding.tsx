import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, MoneyField } from '../src/components/ui';
import { DEBT_KIND_LABEL, createDebt, listDebts, type Debt, type DebtKind } from '../src/services/debts';
import {
  ACCOUNT_KIND_LABEL, addAccount, getNetWorth, listAccounts, setSetting,
  type Account, type AccountKind, type NetWorth,
} from '../src/services/repo';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

type Step = 0 | 1 | 2 | 3;

export default function Onboarding() {
  const { colors } = useTheme();
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);

  const finish = async () => {
    await setSetting('onboarded', '1');
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        {step === 0 && <Welcome onNext={() => setStep(1)} />}
        {step === 1 && <AssetsStep onBack={() => setStep(0)} onNext={() => setStep(2)} />}
        {step === 2 && <LiabilitiesStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <Summary onBack={() => setStep(2)} onFinish={finish} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 16, paddingTop: 40 }}>
      <AppText variant="big" color={colors.primary}>FinZen</AppText>
      <AppText variant="subtitle">Tus finanzas, claras y privadas.</AppText>
      <Card>
        <AppText>• Todo se guarda en tu celular y funciona sin internet.</AppText>
        <AppText>• Lee tus notificaciones bancarias, descartando claves y ocultando números.</AppText>
        <AppText>• Si compras a cuotas (Addi, Sistecrédito…), te pregunto cuántas y calculo intereses.</AppText>
      </Card>
      <AppText color={colors.textSecondary}>
        Primero cuéntame con qué cuentas y qué deudas empiezas. Puedes omitir lo que no tengas y cambiarlo después.
      </AppText>
      <Button label="Comenzar" onPress={onNext} />
    </View>
  );
}

function NavRow({ onBack, onNext, nextLabel = 'Siguiente' }: { onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
      <View style={{ flex: 1 }}><Button label="Atrás" variant="ghost" onPress={onBack} /></View>
      <View style={{ flex: 2 }}><Button label={nextLabel} onPress={onNext} /></View>
    </View>
  );
}

const ACCOUNT_KINDS = Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[];

function AssetsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { colors } = useTheme();
  const [items, setItems] = useState<Account[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('savings');
  const [amount, setAmount] = useState('');

  const reload = useCallback(() => { listAccounts().then(setItems); }, []);
  useEffect(reload, [reload]);

  const add = async () => {
    if (!name.trim()) return;
    await addAccount({ name: name.trim(), kind, balance: parseDigits(amount), currency: 'COP' });
    setName(''); setAmount('');
    reload();
  };

  return (
    <View style={{ gap: 14 }}>
      <AppText variant="title">Tus activos</AppText>
      <AppText color={colors.textSecondary}>Cuentas, efectivo, billeteras (Nequi, Daviplata) e inversiones.</AppText>
      {items.map((a) => (
        <Card key={a.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <AppText>{a.name}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>{ACCOUNT_KIND_LABEL[a.kind]}</AppText>
          </View>
          <AppText color={colors.success}>{formatCOP(a.balance)}</AppText>
        </Card>
      ))}
      <Card>
        <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Nequi, Ahorros Bancolombia" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ACCOUNT_KINDS.map((k) => (
            <Chip key={k} label={ACCOUNT_KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <MoneyField label="Monto actual (COP)" value={amount} onChange={setAmount} />
        <Button label="Agregar activo" variant="ghost" onPress={add} disabled={!name.trim()} />
      </Card>
      <NavRow onBack={onBack} onNext={onNext} />
    </View>
  );
}

const DEBT_KINDS = Object.keys(DEBT_KIND_LABEL) as DebtKind[];

function LiabilitiesStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { colors } = useTheme();
  const [items, setItems] = useState<Debt[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DebtKind>('credit_card');
  const [balance, setBalance] = useState('');
  const [payment, setPayment] = useState('');
  const [rate, setRate] = useState('');
  const [day, setDay] = useState('');
  const [limit, setLimit] = useState('');
  const [cut, setCut] = useState('');
  const isCard = kind === 'credit_card';

  const reload = useCallback(() => { listDebts().then(setItems); }, []);
  useEffect(reload, [reload]);

  const add = async () => {
    const dayOf = (t: string) => { const v = parseDigits(t); return v >= 1 && v <= 31 ? v : null; };
    await createDebt({
      name: name.trim(), kind, balance: parseDigits(balance), monthlyPayment: parseDigits(payment),
      annualRatePct: Number(rate.replace(',', '.')) || 0,
      dueDay: dayOf(day), cutDay: isCard ? dayOf(cut) : null, creditLimit: isCard ? parseDigits(limit) || null : null,
    });
    setName(''); setBalance(''); setPayment(''); setRate(''); setDay(''); setLimit(''); setCut('');
    reload();
  };

  return (
    <View style={{ gap: 14 }}>
      <AppText variant="title">Tus deudas</AppText>
      <AppText color={colors.textSecondary}>
        Tarjetas, créditos, Addi, Sistecrédito, préstamos a familiares… Las compras futuras a cuotas las iré
        detectando yo.
      </AppText>
      {items.map((d) => (
        <Card key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <AppText>{d.name}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {DEBT_KIND_LABEL[d.kind]}{d.monthly_payment ? ` · cuota ${formatCOP(d.monthly_payment)}` : ''}
              {d.due_day ? ` · día ${d.due_day}` : ''}
            </AppText>
          </View>
          <AppText color={colors.danger}>{formatCOP(d.balance)}</AppText>
        </Card>
      ))}
      <Card>
        <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Addi, Tarjeta Nu" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DEBT_KINDS.map((k) => (
            <Chip key={k} label={DEBT_KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        {isCard && <MoneyField label="Cupo total de la tarjeta (COP)" value={limit} onChange={setLimit} />}
        <MoneyField label={isCard ? 'Lo que debes hoy en la tarjeta (COP)' : 'Lo que debes hoy (COP)'} value={balance} onChange={setBalance} />
        {!isCard && <MoneyField label="Cuota mensual (COP)" value={payment} onChange={setPayment} />}
        <Field
          label="Tasa de interés efectiva anual % (opcional)"
          value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="Ej. 28.5"
        />
        {isCard && <Field label="Día de corte (1-31)" value={cut} onChangeText={(t) => setCut(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="Ej. 10" />}
        <Field label={isCard ? 'Día límite de pago (1-31)' : 'Día de pago (1-31)'} value={day} onChangeText={(t) => setDay(t.replace(/\D/g, '').slice(0, 2))}
          keyboardType="number-pad" placeholder="Ej. 15" />
        <Button label="Agregar deuda" variant="ghost" onPress={add} disabled={!name.trim() || (isCard ? !parseDigits(limit) : !parseDigits(balance))} />
      </Card>
      <NavRow onBack={onBack} onNext={onNext} />
    </View>
  );
}

function Summary({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const { colors } = useTheme();
  const [nw, setNw] = useState<NetWorth | null>(null);
  useEffect(() => { getNetWorth().then(setNw); }, []);
  if (!nw) return null;
  return (
    <View style={{ gap: 14 }}>
      <AppText variant="title">Tu patrimonio neto</AppText>
      <Card>
        <AppText variant="caption" color={colors.textSecondary}>Activos − Pasivos</AppText>
        <AppText variant="big" color={nw.net >= 0 ? colors.success : colors.danger}>{formatCOP(nw.net)}</AppText>
      </Card>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <AppText variant="caption" color={colors.textSecondary}>Activos</AppText>
          <AppText variant="subtitle" color={colors.success}>{formatCOP(nw.assets)}</AppText>
        </Card>
        <Card style={{ flex: 1 }}>
          <AppText variant="caption" color={colors.textSecondary}>Pasivos</AppText>
          <AppText variant="subtitle" color={colors.danger}>{formatCOP(nw.liabilities)}</AppText>
        </Card>
      </View>
      <NavRow onBack={onBack} onNext={onFinish} nextLabel="Empezar" />
    </View>
  );
}
