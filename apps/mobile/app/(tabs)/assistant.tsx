import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseAiText, type ChatMessage } from '@finzen/core';
import { AppText, Card, Chip } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { askAssistant, isAiConfigured } from '../../src/services/ai';
import { useTheme } from '../../src/theme/ThemeProvider';

/** Muestra la respuesta de la IA sin símbolos de Markdown: negrilla real, viñetas y párrafos cortos. */
function AiMessage({ text, color }: { text: string; color: string }) {
  const blocks = parseAiText(text);
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((b, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
          {b.kind === 'bullet' && <AppText color={color}>•</AppText>}
          {b.kind === 'number' && <AppText color={color}>{b.n}.</AppText>}
          <View style={{ flex: 1 }}>
            <AppText color={color}>
              {b.spans.map((s, j) => (s.bold || b.kind === 'heading'
                ? <Text key={j} style={{ fontWeight: '700' }}>{s.text}</Text>
                : <Text key={j}>{s.text}</Text>))}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const SUGGESTIONS = [
  '¿Cuánto gasté en comida este mes?',
  '¿Voy bien con mi presupuesto?',
  '¿Qué deuda debería pagar primero?',
  '¿Dónde puedo recortar gastos?',
];

export default function Assistant() {
  const { colors } = useTheme();
  const router = useRouter();
  const [configured] = useFocusData(isAiConfigured, true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQ, setLastQ] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  // Al abrir el teclado, el chat baja al final para que se siga viendo lo que escribes.
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
    });
    return () => sub.remove();
  }, []);

  const send = async (text: string, isRetry = false) => {
    const q = text.trim();
    if (!q || busy) return;
    setError(null); setBusy(true); setLastQ(q);
    const history = isRetry ? messages.slice(0, -1) : messages;
    if (!isRetry) {
      setInput('');
      setMessages([...history, { role: 'user', content: q }]);
    }
    try {
      const answer = await askAssistant(q, history);
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12 }}>
          <AppText variant="title">Asistente</AppText>
          <Pressable onPress={() => router.push('/assistant-settings')} hitSlop={12} accessibilityLabel="Configurar IA">
            <Ionicons name="settings-outline" size={24} color={colors.primary} />
          </Pressable>
        </View>

        <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          {!configured && (
            <Card style={{ borderColor: colors.warning }}>
              <AppText color={colors.warning}>El asistente necesita una IA configurada.</AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                Toca el engranaje ⚙ y pega una clave gratuita de Gemini (Google AI Studio), o la dirección de tu Ollama. El resto de la app funciona sin esto.
              </AppText>
            </Card>
          )}
          {messages.length === 0 && (
            <View style={{ gap: 8 }}>
              <AppText color={colors.textSecondary}>Pregúntame sobre tus finanzas. Solo veo totales, sin nombres de cuentas, bancos ni comercios.</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SUGGESTIONS.map((s) => <Chip key={s} label={s} selected={false} onPress={() => send(s)} />)}
              </View>
            </View>
          )}
          {messages.map((m, i) => (
            <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
              <Card style={{ backgroundColor: m.role === 'user' ? colors.primary : colors.surface, borderColor: m.role === 'user' ? colors.primary : colors.border }}>
                {m.role === 'user' ? <AppText color={colors.onPrimary}>{m.content}</AppText> : <AiMessage text={m.content} color={colors.text} />}
              </Card>
            </View>
          ))}
          {busy && <AppText color={colors.textSecondary}>Pensando…</AppText>}
          {error && (
            <View style={{ gap: 6 }}>
              <AppText color={colors.danger}>{error}</AppText>
              {lastQ && !busy && (
                <Pressable onPress={() => send(lastQ, true)} hitSlop={8}>
                  <AppText color={colors.primary}>↻ Reintentar</AppText>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
          <TextInput
            value={input} onChangeText={setInput} placeholder="Escribe tu pregunta…" placeholderTextColor={colors.textSecondary}
            onSubmitEditing={() => send(input)} returnKeyType="send" multiline
            style={{ flex: 1, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, maxHeight: 100, fontSize: 16 }}
          />
          <Pressable onPress={() => send(input)} disabled={busy || !input.trim()}
            style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: busy || !input.trim() ? 0.4 : 1 }}>
            <Ionicons name="send" size={20} color={colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}