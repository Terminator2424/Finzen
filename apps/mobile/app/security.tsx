import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLock } from '../src/components/LockProvider';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import { biometricAvailable, clearPin, hasPin, setPin } from '../src/services/security';
import { useTheme } from '../src/theme/ThemeProvider';

const MINUTES = [1, 5, 15, 30];

export default function Security() {
  const { colors } = useTheme();
  const { prefs, updatePrefs } = useLock();
  const [pinSet, setPinSet] = useState(false);
  const [bio, setBio] = useState(false);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { hasPin().then(setPinSet); biometricAvailable().then(setBio); }, []);

  const savePin = async () => {
    if (!/^\d{4,6}$/.test(pin1)) return setMsg('El PIN debe tener de 4 a 6 números.');
    if (pin1 !== pin2) return setMsg('Los PIN no coinciden.');
    await setPin(pin1);
    setPinSet(true); setPin1(''); setPin2('');
    await updatePrefs({ enabled: true });
    setMsg('✓ PIN guardado y bloqueo activado.');
  };

  const disable = () =>
    Alert.alert('Desactivar bloqueo', 'FinZen quedará abierta sin PIN ni huella.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Desactivar', style: 'destructive', onPress: async () => { await updatePrefs({ enabled: false }); await clearPin(); setPinSet(false); } },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Seguridad" />

        <Card>
          <AppText variant="subtitle">{pinSet ? 'Cambiar PIN' : 'Crear PIN de respaldo'}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            El PIN se pide cuando la huella falla o no está disponible. Se guarda cifrado en el almacén seguro del celular.
          </AppText>
          <Field label="PIN nuevo (4 a 6 números)" value={pin1} onChangeText={(t) => setPin1(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry />
          <Field label="Repite el PIN" value={pin2} onChangeText={(t) => setPin2(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry />
          <Button label={pinSet ? 'Cambiar PIN' : 'Guardar PIN y activar bloqueo'} onPress={savePin} />
          {msg && <AppText variant="caption" color={msg.startsWith('✓') ? colors.success : colors.danger}>{msg}</AppText>}
        </Card>

        <Card>
          <Row label="Bloquear capturas de pantalla y vista previa en apps recientes" value={prefs.secureScreen} onChange={(v) => updatePrefs({ secureScreen: v })} />
          <AppText variant="caption" color={colors.textSecondary}>
            Activado por defecto: Android no deja tomar capturas de FinZen ni muestra tu saldo en la lista de apps recientes. Desactívalo solo si necesitas una captura (por ejemplo para reportar un error).
          </AppText>
        </Card>

        {pinSet && (
          <>
            <Card>
              <Row label="Bloqueo activado" value={prefs.enabled} onChange={(v) => (v ? updatePrefs({ enabled: true }) : disable())} />
              <Row label={bio ? 'Huella / rostro' : 'Huella / rostro (no disponible o sin registrar)'} value={prefs.biometric && bio} disabled={!bio} onChange={(v) => updatePrefs({ biometric: v })} />
            </Card>
            <Card>
              <AppText variant="subtitle">Bloqueo automático</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Se bloquea tras este tiempo sin usar la app.</AppText>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {MINUTES.map((m) => <Chip key={m} label={`${m} min`} selected={prefs.minutes === m} onPress={() => updatePrefs({ minutes: m })} />)}
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}><AppText>{label}</AppText></View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}
