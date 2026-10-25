import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseReceiptText, type ParsedReceipt } from '@finzen/core';
import { AppText, Button, Card, Field, MoneyField, ScreenHeader } from '../src/components/ui';
import { deleteQuietly } from '../src/services/backup';
import { useTheme } from '../src/theme/ThemeProvider';
import { groupDigits, parseDigits } from '../src/utils/format';

/**
 * OCR de recibos 100 % en el celular (ML Kit): la foto nunca sale del dispositivo.
 * El resultado es una propuesta: el usuario la corrige antes de pasar al formulario.
 */
export default function Scan() {
  const { colors } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState<number | null>(null);

  const scan = async (camera: boolean) => {
    setErr(null); setBusy(true);
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) throw new Error('Necesito permiso para ' + (camera ? 'usar la cámara.' : 'ver tus fotos.'));
      const res = camera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (res.canceled) return;

      // Import dinámico: si el APK no trae ML Kit, la app no se cae, solo avisa.
      let recognize: (uri: string) => Promise<{ text: string }>;
      try { recognize = (await import('@react-native-ml-kit/text-recognition')).default.recognize; }
      catch { throw new Error('Esta versión de la app no incluye el lector de recibos. Instala el APK más reciente.'); }

      const photoUri = res.assets[0]!.uri;
      let text: string;
      try { ({ text } = await recognize(photoUri)); } finally { deleteQuietly(photoUri); } // la foto no se conserva
      if (!text.trim()) throw new Error('No pude leer texto en la foto. Intenta con más luz y el recibo plano.');
      const parsed: ParsedReceipt = parseReceiptText(text);
      setRaw(text);
      setAmount(parsed.amount ? groupDigits(String(parsed.amount)) : '');
      setMerchant(parsed.merchant ?? '');
      setDate(parsed.date);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Escanear recibo" />
        <AppText color={colors.textSecondary}>Lee el total, el comercio y la fecha. La foto se procesa en tu celular y no se guarda ni se envía.</AppText>
        <Button label={busy ? 'Leyendo…' : '📷 Tomar foto'} disabled={busy} onPress={() => scan(true)} />
        <Button variant="ghost" label="Elegir de la galería" disabled={busy} onPress={() => scan(false)} />
        {err && <AppText color={colors.danger}>{err}</AppText>}

        {raw !== null && (
          <Card>
            <AppText variant="subtitle">Revisa lo que leí</AppText>
            <MoneyField label="Total (COP)" value={amount} onChange={setAmount} />
            <Field label="Comercio" value={merchant} onChangeText={setMerchant} />
            {date && <AppText variant="caption" color={colors.textSecondary}>Fecha detectada: {new Date(date).toLocaleDateString('es-CO')}</AppText>}
            <Button label="Usar en una transacción" disabled={!parseDigits(amount)}
              onPress={() => router.replace({ pathname: '/transaction/new', params: { amount: String(parseDigits(amount)), merchant, ...(date ? { date: String(date) } : {}) } })} />
            <AppText variant="caption" color={colors.textSecondary}>Texto leído:</AppText>
            <AppText variant="caption" color={colors.textSecondary}>{raw.slice(0, 400)}</AppText>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
