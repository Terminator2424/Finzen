import React, { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import {
  GeminiError, cleanModelName, getAiConfig, getGeminiKey, resetGeminiModel, saveAiConfig, saveGeminiKey, testGeminiConnection,
  type AiConfig, type AiProvider,
} from '../src/services/ai';
import { useTheme } from '../src/theme/ThemeProvider';

export default function AssistantSettings() {
  const { colors } = useTheme();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tech, setTech] = useState<string | null>(null);

  useEffect(() => { getAiConfig().then(setCfg); getGeminiKey().then((k) => setKey(k ?? '')); }, []);
  if (!cfg) return null;
  const set = (p: Partial<AiConfig>) => { setCfg({ ...cfg, ...p }); setMsg(null); setErr(null); setTech(null); };

  const k = key.trim();
  const keyHint = k
    ? `${k.length} caracteres · empieza con "${k.slice(0, 3)}"${/\s/.test(k) ? ' · ⚠ tiene espacios: copia la clave de nuevo' : ''}`
    : null;
  const modelLine = cfg.geminiModel.trim()
    ? `Modelo fijado: ${cleanModelName(cfg.geminiModel)}`
    : `Modo automático${cfg.geminiCache ? ` · último modelo que funcionó: ${cfg.geminiCache}` : ''}`;

  const save = async () => {
    setErr(null); setTech(null); setMsg(null); setBusy(true);
    try {
      const clean: AiConfig = { ...cfg, geminiModel: cleanModelName(cfg.geminiModel) };
      await saveGeminiKey(k);
      await saveAiConfig(clean);
      if (clean.provider === 'gemini' && k) {
        const t = await testGeminiConnection(k, clean.geminiModel);
        const next: AiConfig = { ...clean, geminiCache: t.model, geminiModel: t.pinnedCleared ? '' : clean.geminiModel };
        await saveAiConfig(next);
        setCfg(next);
        if (t.from && t.from !== t.model) {
          setMsg(t.pinnedCleared
            ? `⚠ El modelo "${t.from}" no sirve con tu clave (${t.reason}). Quedó en modo automático con ${t.model}.`
            : `⚠ "${t.from}" no respondió ahora (${t.reason}). Se usó ${t.model} esta vez.`);
        } else {
          setMsg(`✓ Guardado. Conexión correcta con ${t.model} (${t.ms} ms)${clean.geminiModel ? '' : ' · modo automático'}.`);
        }
      } else {
        setCfg(clean);
        setMsg('✓ Guardado.');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (e instanceof GeminiError) setTech(`HTTP ${e.status} · ${e.googleStatus || '-'} · ${e.reason || '-'}\n${e.detail}`);
    } finally {
      setBusy(false);
    }
  };

  const toAuto = async () => {
    await resetGeminiModel();
    set({ geminiModel: '', geminiCache: '' });
    setMsg('✓ Modelo en automático. Toca "Guardar y probar" para elegir uno.');
  };

  // La app bloquea las capturas de pantalla: así se puede compartir el detalle del error (sin la clave).
  const shareDetail = () => {
    Share.share({
      message: `Prueba de IA (FinZen)\nProveedor: ${cfg.provider}\nModelo: ${cfg.geminiModel || '(automático)'}\nClave: ${k.length} caracteres, empieza con "${k.slice(0, 3)}"\nError: ${err ?? '-'}\n${tech ?? ''}`,
    }).catch(() => {});
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
              1) Entra a aistudio.google.com con tu cuenta Google. 2) “Get API key” → crea una clave gratis (hoy empiezan por “AQ.”). 3) Pégala aquí y toca “Guardar y probar”.
              Se guarda cifrada en este celular. El nivel gratuito tiene límites de uso y Google puede usar lo que envíes para mejorar sus productos: por eso solo salen totales anonimizados.
            </AppText>
            <Field label="Clave de API" value={key} onChangeText={setKey} autoCapitalize="none" secureTextEntry={!showKey} placeholder="AQ.… o AIza…" />
            {keyHint && <AppText variant="caption" color={colors.textSecondary}>{keyHint}</AppText>}
            <Button variant="ghost" label={showKey ? 'Ocultar clave' : 'Mostrar clave'} onPress={() => setShowKey(!showKey)} />
            <Field label="Modelo fijado (déjalo vacío para automático)" value={cfg.geminiModel} onChangeText={(t) => set({ geminiModel: t })} autoCapitalize="none" />
            <AppText variant="caption" color={colors.textSecondary}>{modelLine}</AppText>
            <Button variant="ghost" label="Restablecer a automático" onPress={toAuto} />
          </Card>
        ) : (
          <Card>
            <AppText variant="subtitle">Ollama (opcional)</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Solo si quieres una IA 100 % privada en tu PC. La PC debe estar encendida, en la misma red WiFi, con Ollama escuchando en la red
              (variable OLLAMA_HOST=0.0.0.0). Ejemplo de dirección: https://mi-pc.ejemplo.net
            </AppText>
            <Field label="Dirección de Ollama" value={cfg.ollamaUrl} onChangeText={(t) => set({ ollamaUrl: t })} autoCapitalize="none" placeholder="https://mi-pc.ejemplo.net" />
            <Field label="Modelo" value={cfg.ollamaModel} onChangeText={(t) => set({ ollamaModel: t })} autoCapitalize="none" />
          </Card>
        )}

        <Button label={busy ? 'Probando…' : 'Guardar y probar'} onPress={save} disabled={busy} />
        {msg && <AppText color={msg.startsWith('✓') ? colors.success : colors.warning}>{msg}</AppText>}
        {err && (
          <>
            <AppText color={colors.danger}>{err}</AppText>
            <Button variant="ghost" label="Compartir detalle del error" onPress={shareDetail} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}