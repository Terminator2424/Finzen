import React from 'react';
import { Linking, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationListener } from '../modules/finzen-notifications';
import { AppText, Button, Card, ScreenHeader } from '../src/components/ui';
import { openBatteryExemption } from '../src/services/listenerHealth';
import { useTheme } from '../src/theme/ThemeProvider';

export default function NotificationHelp() {
  const { colors } = useTheme();
  const muted = colors.textSecondary;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Guía de configuración" />

        <Card>
          <AppText variant="subtitle">1. Dar acceso a las notificaciones</AppText>
          <AppText variant="caption" color={muted}>
            Android pide un permiso especial para que una app lea notificaciones. Activa FinZen en la lista.
          </AppText>
          <Button label="Abrir ajustes de acceso" onPress={() => NotificationListener.openSettings()} />
        </Card>

        <Card>
          <AppText variant="subtitle">2. Si el interruptor sale gris (Android 13 o superior)</AppText>
          <AppText variant="caption" color={muted}>
            Las apps instaladas desde un archivo APK quedan con “ajustes restringidos”. Abre la información de la app,
            toca los tres puntos de arriba a la derecha y elige “Permitir ajustes restringidos”. Luego repite el paso 1.
          </AppText>
          <Button variant="ghost" label="Abrir información de la app" onPress={() => NotificationListener.openAppSettings()} />
        </Card>

        <Card>
          <AppText variant="subtitle">3. Evitar que el sistema cierre el lector</AppText>
          <AppText variant="caption" color={muted}>
            Algunos fabricantes (Samsung, Xiaomi, Motorola, Huawei) congelan las apps en segundo plano. Quita la
            restricción de batería de FinZen. Los nombres de los menús cambian según la marca; en dontkillmyapp.com hay
            instrucciones por modelo.
          </AppText>
          <Button label="Quitar restricción de batería" onPress={openBatteryExemption} />
          <Button variant="ghost" label="Ver instrucciones por marca" onPress={() => Linking.openURL('https://dontkillmyapp.com')} />
        </Card>

        <Card>
          <AppText variant="subtitle">4. Agregar tus apps</AppText>
          <AppText variant="caption" color={muted}>
            FinZen no lee ninguna app por defecto. Activa el Modo Aprendizaje, haz una operación en tu banco y toca
            “Agregar” en la app que aparezca. Desde ese momento se lee sola; no hay que hacer nada más.
          </AppText>
        </Card>

        <Card>
          <AppText variant="subtitle">5. Si algo no funciona</AppText>
          <AppText variant="caption" color={muted}>
            • El estado debe decir “🟢 Conectado”. Si dice rojo, toca “Reconectar lector”.{'\n'}
            • Si “Última notificación vista” no cambia al recibir una notificación, el sistema no la está entregando: revisa los pasos 1 a 3.{'\n'}
            • Si la notificación se ve pero no aparece como movimiento, revisa la bandeja de Borradores: ahí queda lo que no se pudo interpretar.{'\n'}
            • El Diagnóstico técnico muestra qué decidió el filtro con cada notificación.
          </AppText>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}