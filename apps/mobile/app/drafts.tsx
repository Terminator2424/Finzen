import React from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { deleteAllDrafts, deleteDraft, listDrafts, type DraftNotification } from '../src/services/notifications';
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
        draftId: draft.id
      },
    });
  };

  const handleDelete = (id: string) => {
    Alert.alert('Descartar notificación', '¿Seguro que quieres eliminarla?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await deleteDraft(id); reload(); } },
    ]);
  };

  // NUEVO: Función para borrar todo
  const handleDeleteAll = () => {
    if (drafts.length === 0) return;
    Alert.alert('Borrar todo', '¿Seguro que quieres borrar TODAS las notificaciones pendientes?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Borrar todo', style: 'destructive', onPress: async () => { 
        await deleteAllDrafts(); 
        reload(); 
      } },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <ScreenHeader title="Borradores por revisar" />
        
        {/* NUEVO: Botón de borrar todo */}
        {drafts.length > 0 && (
          <Button 
            variant="ghost" 
            label="🗑️ Borrar todas las notificaciones" 
            onPress={handleDeleteAll} 
          />
        )}

        <AppText color={colors.textSecondary} style={{ marginBottom: 8 }}>
          FinZen recibió estas notificaciones pero no las entendió. Procesa los mensajes que sí sean transacciones o borra todo si es basura.
        </AppText>

        {drafts.length === 0 && (
          <Card><AppText color={colors.success}>✅ Todo al día.</AppText></Card>
        )}

        {drafts.map((d) => (
          <Card key={d.id}>
            <View style={{ gap: 6 }}>
              <AppText variant="caption" color={colors.primary}>De: {d.source_package}</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Recibida: {new Date(d.received_at).toLocaleString('es-CO')}</AppText>
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