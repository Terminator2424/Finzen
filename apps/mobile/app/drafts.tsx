import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { deleteDraft, listDrafts, type DraftNotification } from '../src/services/notifications';
import { useTheme } from '../src/theme/ThemeProvider';

export default function DraftsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [drafts, reload] = useFocusData(listDrafts, []);

  const handleProcess = (draft: DraftNotification) => {
    router.push({
      pathname: '/transaction/new',
      params: { 
        merchant: draft.masked_text,
        draftId: draft.id // <--- NUEVO: Pasamos el ID para borrarlo luego
      },
    });
  };

  const handleDelete = (id: string) => {
    Alert.alert('Descartar notificación', '¿Seguro que quieres eliminarla? No se registrará ningún movimiento.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          await deleteDraft(id);
          reload();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <ScreenHeader title="Notificaciones por revisar" />
        <AppText color={colors.textSecondary} style={{ marginBottom: 8 }}>
          FinZen recibió estas notificaciones, pero el formato no fue reconocido automáticamente. Toca "Procesar" para registrar el movimiento.
        </AppText>

        {drafts.length === 0 && (
          <Card>
            <AppText color={colors.success}>✅ Todo al día. No hay notificaciones pendientes por revisar.</AppText>
          </Card>
        )}

        {drafts.map((d) => (
          <Card key={d.id}>
            <View style={{ gap: 6 }}>
              <AppText variant="caption" color={colors.primary}>
                De: {d.source_package}
              </AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                Recibida: {new Date(d.received_at).toLocaleString('es-CO')}
              </AppText>
              <Card style={{ backgroundColor: colors.surface, padding: 10, marginTop: 4 }}>
                <AppText style={{ fontStyle: 'italic' }}>"{d.masked_text}"</AppText>
              </Card>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <Button variant="ghost" label="Descartar 🗑️" onPress={() => handleDelete(d.id)} />
                <Button label="Procesar ➡️" onPress={() => handleProcess(d)} />
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}