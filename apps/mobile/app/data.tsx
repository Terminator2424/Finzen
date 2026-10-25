import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ColumnMap } from '@finzen/core';
import { useLock } from '../src/components/LockProvider';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import {
  exportBackupJson, exportTransactionsCsv, importCsvRows, previewCsv, readPickedFile, restoreBackup, wipeAllData, type CsvPreview,
} from '../src/services/backup';
import { useTheme } from '../src/theme/ThemeProvider';

export default function DataScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { updatePrefs } = useLock();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<CsvPreview | null>(null);
  const [positiveIncome, setPositiveIncome] = useState<boolean | undefined>(undefined);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ text: t, ok: true }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), ok: false }); }
    finally { setBusy(false); }
  };

  const pick = async (types: string[]) => {
    const r = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
    return r.canceled ? null : await readPickedFile(r.assets[0]!.uri);
  };

  const importCsv = () => run(async () => {
    const text = await pick(['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*']);
    if (text === null) return;
    const p = previewCsv(text);
    if (!p.map) throw new Error('No encontré columnas de fecha y descripción. Revisa que la primera fila sea el encabezado (Fecha, Descripción, Valor…).');
    setCsv(p);
  });

  const confirmImport = (map: ColumnMap) => run(async () => {
    const r = await importCsvRows(csv!.rows, map, positiveIncome);
    setCsv(null);
    return `✓ Importadas ${r.imported}. Repetidas: ${r.duplicates}. Omitidas por formato: ${r.skipped}.`;
  });

  const restore = () => run(async () => {
    const text = await pick(['application/json', 'text/plain', '*/*']);
    if (text === null) return;
    // Si el respaldo está cifrado, la contraseña se escribe en el campo de abajo ANTES de elegir el archivo.
    await new Promise<void>((resolve, reject) =>
      Alert.alert('Restaurar copia', 'Esto REEMPLAZA todos los datos actuales por los de la copia. ¿Continuar?', [
        { text: 'Cancelar', style: 'cancel', onPress: () => reject(new Error('Restauración cancelada.')) },
        { text: 'Restaurar', style: 'destructive', onPress: () => resolve() },
      ]),
    );
    const n = await restoreBackup(text, pass || undefined);
    return `✓ Restauradas ${n} filas. Reinicia la app para ver todo actualizado.`;
  });

  const wipe = () =>
    Alert.alert('Eliminar todos mis datos', 'Se borran cuentas, deudas, movimientos, presupuestos y ajustes de ESTE celular. No se puede deshacer. Si usas Supabase, bórralos también desde Sincronización.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar todo', style: 'destructive', onPress: () => Alert.alert('¿Seguro?', 'Última confirmación.', [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, eliminar', style: 'destructive', onPress: () => run(async () => { await updatePrefs({ enabled: false }); await wipeAllData(); router.replace('/'); }) },
      ]) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Mis datos" />
        <AppText color={colors.textSecondary}>Tus datos viven en este celular. Aquí los sacas, los traes o los borras.</AppText>

        <Card>
          <AppText variant="subtitle">Exportar</AppText>
          <Button variant="ghost" label="Movimientos en CSV (Excel)" disabled={busy} onPress={() => run(async () => `✓ ${await exportTransactionsCsv()} movimientos exportados.`)} />
          <AppText variant="caption" color={colors.textSecondary}>El CSV sale SIN cifrar (es para abrirlo en Excel): no lo dejes en lugares públicos.</AppText>
          <AppText variant="subtitle">Copia de seguridad cifrada</AppText>
          <Field label="Contraseña del respaldo (mínimo 10 caracteres)" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" />
          <Field label="Repite la contraseña (solo al crear)" value={pass2} onChangeText={setPass2} secureTextEntry autoCapitalize="none" />
          <Button variant="ghost" label="Crear copia de seguridad cifrada"
            disabled={busy || pass.length < 10 || pass !== pass2}
            onPress={() => run(async () => { await exportBackupJson(pass); return '✓ Copia creada. Guarda la contraseña: sin ella NADIE puede abrirla (ni yo).'; })} />
          <AppText variant="caption" color={colors.textSecondary}>Se cifra con AES-256 antes de salir de la app. Luego se abre el menú de compartir: guárdala en Drive o envíala a tu PC.</AppText>
        </Card>

        <Card>
          <AppText variant="subtitle">Importar</AppText>
          <Button variant="ghost" label="Extracto bancario (CSV)" disabled={busy} onPress={importCsv} />
          <AppText variant="caption" color={colors.textSecondary}>Para restaurar una copia cifrada, escribe primero su contraseña en el campo de arriba.</AppText>
          <Button variant="ghost" label="Restaurar copia de seguridad" disabled={busy} onPress={restore} />
        </Card>

        {csv?.map && (
          <Card>
            <AppText variant="subtitle">Vista previa</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              {csv.rows.length} filas. Fecha: “{csv.header[csv.map.date]}” · Descripción: “{csv.header[csv.map.description]}” ·
              {csv.map.debit !== null ? ` Débito: “${csv.header[csv.map.debit]}” · Crédito: “${csv.header[csv.map.credit!]}”` : ` Monto: “${csv.header[csv.map.amount ?? 0]}”`}
            </AppText>
            {csv.rows.slice(0, 3).map((r, i) => <AppText key={i} variant="caption">{r.join(' | ').slice(0, 90)}</AppText>)}
            {csv.map.debit === null && (
              <>
                <AppText variant="caption" color={colors.textSecondary}>¿Cómo vienen los montos positivos?</AppText>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Chip label="Automático" selected={positiveIncome === undefined} onPress={() => setPositiveIncome(undefined)} />
                  <Chip label="Positivo = ingreso" selected={positiveIncome === true} onPress={() => setPositiveIncome(true)} />
                  <Chip label="Positivo = gasto" selected={positiveIncome === false} onPress={() => setPositiveIncome(false)} />
                </View>
              </>
            )}
            <AppText variant="caption" color={colors.textSecondary}>Se importan como historial: no cambian los saldos de tus cuentas, y volver a importar el mismo archivo no duplica nada.</AppText>
            <Button label="Importar" disabled={busy} onPress={() => confirmImport(csv.map!)} />
            <Button variant="ghost" label="Cancelar" onPress={() => setCsv(null)} />
          </Card>
        )}

        <Card style={{ borderColor: colors.danger }}>
          <AppText variant="subtitle" color={colors.danger}>Zona de peligro</AppText>
          <Button variant="ghost" label="Eliminar todos mis datos" onPress={wipe} />
        </Card>

        {msg && <AppText color={msg.ok ? colors.success : colors.danger}>{msg.text}</AppText>}
      </ScrollView>
    </SafeAreaView>
  );
}
