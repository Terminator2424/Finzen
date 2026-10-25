import React, { useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { AppText, Button } from './ui';

/**
 * Dictado por voz (reconocimiento del sistema Android, en español de Colombia).
 * Carga la librería de forma "segura": si el APK no la trae, el botón simplemente no aparece.
 */
type SpeechLib = typeof import('expo-speech-recognition');
let Speech: SpeechLib | null = null;
try { Speech = require('expo-speech-recognition') as SpeechLib; } catch { Speech = null; }

export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  return Speech ? <VoiceInner S={Speech} onText={onText} /> : null;
}

function VoiceInner({ S, onText }: { S: SpeechLib; onText: (t: string) => void }) {
  const { colors } = useTheme();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<boolean | null>(null);

  S.useSpeechRecognitionEvent('result', (e) => {
    const t = e.results[0]?.transcript ?? '';
    setHeard(t);
    if (e.isFinal && t) onText(t);
  });
  S.useSpeechRecognitionEvent('end', () => setListening(false));
  S.useSpeechRecognitionEvent('error', (e) => { setListening(false); if (e.error !== 'no-speech' && e.error !== 'aborted') setErr(e.message || 'No pude escuchar.'); });

  const toggle = async () => {
    setErr(null);
    if (listening) { S.ExpoSpeechRecognitionModule.stop(); return; }
    const perm = await S.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { setErr('Necesito permiso del micrófono.'); return; }
    setHeard('');
    setListening(true);
    // Si el celular tiene el modelo de voz sin conexión, el audio NO sale del dispositivo.
    let onDevice = false;
    try { onDevice = S.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(); } catch { onDevice = false; }
    setLocal(onDevice);
    S.ExpoSpeechRecognitionModule.start({ lang: 'es-CO', interimResults: true, requiresOnDeviceRecognition: onDevice });
  };

  return (
    <View style={{ gap: 4 }}>
      <Button variant="ghost" label={listening ? '🎤 Escuchando… (toca para parar)' : '🎤 Dictar (“gasté veinte mil en almuerzo”)'} onPress={toggle} />
      {local === false ? <AppText variant="caption" color={colors.warning}>Tu celular no tiene voz sin conexión: el audio lo procesa el servicio de voz de Google.</AppText> : null}
      {heard ? <AppText variant="caption" color={colors.textSecondary}>“{heard}”</AppText> : null}
      {err ? <AppText variant="caption" color={colors.danger}>{err}</AppText> : null}
    </View>
  );
}
