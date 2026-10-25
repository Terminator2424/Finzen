import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import {
  discoverGeminiModel, getAiConfig, getGeminiKey, saveAiConfig, saveGeminiKey, type AiConfig, type AiProvider,
} from '../src/services/ai';
import { useTheme } from '../src/theme/ThemeProvider';

export default function AssistantSettings() {
  const { colors } = useTheme();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getAiConfig().then(setCfg); getGeminiKey().then((k) => setKey(k ?? '')); }, []);
  if (!cfg) return null;
  const set = (p: Partial<AiConfig>) => { setCfg({ ...cfg, ...p }); setMsg(null); setErr(null); };

  const save = async () => {
    setErr(null);
    try {
      await saveGeminiKey(key);
      await saveAiConfig(cfg);
      if (cfg.provider === 'gemini' && key.trim()) {
        const model = cfg.geminiModel || (await discoverGeminiModel(key.trim()));
        setCfg({ ...cfg, geminiModel: model });
        await saveAiConfig({ ...cfg, geminiModel: model });
        setMsg(`✓ Guardado. Conexión correcta con ${model}.`);
      } else setMsg('✓ Guardado.');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Configurar IA" />
        <AppText color={colors.textSecondary}>
          La IA solo recibe totales anonimizados (sin nombres de cuentas, bancos ni comercios). Es opcional: el resto de la app no la necesita.
        </AppText>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['gemini', 'ollama'] as AiProvider[]).map((p) => (
            <Chip key={p} label={p === 'gemini' ? 'Gemini (nube, gratis)' : 'Ollama (tu PC)'} selected={cfg.provider === p} onPress={() => set({ provider: p })} />
          ))}
        </View>

        {cfg.provider === 'gemini' ? (
          <Card>
            <AppText variant="subtitle">Gemini</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              1) Entra a aistudio.google.com con tu cuenta Google. 2) “Get API key” → crea una clave gratis. 3) Pégala aquí. Se guarda cifrada en este celular.
              El nivel gratuito tiene límites de uso y Google puede usar lo que envíes para mejorar sus productos: por eso solo salen totales anonimizados.
            </AppText>
            <Field label="Clave de API" value={key} onChangeText={setKey} autoCapitalize="none" secureTextEntry placeholder="AIza…" />
            <Field label="Modelo (vacío = elegir el Flash más reciente)" value={cfg.geminiModel} onChangeText={(t) => set({ geminiModel: t })} autoCapitalize="none" />
          </Card>
        ) : (
          <Card>
            <AppText variant="subtitle">Ollama (opcional)</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Solo si quieres una IA 100 % privada en tu PC. La PC debe estar encendida, en la misma red WiFi, con Ollama escuchando en la red
              (variable OLLAMA_HOST=0.0.0.0). Ejemplo de dirección: http://192.168.1.20:11434
            </AppText>
            <Field label="Dirección de Ollama" value={cfg.ollamaUrl} onChangeText={(t) => set({ ollamaUrl: t })} autoCapitalize="none" placeholder="http://192.168.1.20:11434" />
            <Field label="Modelo" value={cfg.ollamaModel} onChangeText={(t) => set({ ollamaModel: t })} autoCapitalize="none" />
          </Card>
        )}

        <Button label="Guardar y probar" onPress={save} />
        {msg && <AppText color={colors.success}>{msg}</AppText>}
        {err && <AppText color={colors.danger}>{err}</AppText>}
      </ScrollView>
    </SafeAreaView>
  );
}
