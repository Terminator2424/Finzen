import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/theme/ThemeProvider';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: import('react-native').ColorValue; size: number }) => <Ionicons name={icon} size={size} color={color} />,
});

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={tab('Inicio', 'home')} />
      <Tabs.Screen name="transactions" options={tab('Movimientos', 'swap-vertical')} />
      <Tabs.Screen name="debts" options={tab('Deudas', 'card')} />
      <Tabs.Screen name="assistant" options={tab('Asistente', 'sparkles')} />
      <Tabs.Screen name="settings" options={tab('Ajustes', 'settings')} />
    </Tabs>
  );
}
