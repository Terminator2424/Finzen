import React, { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { getSetting } from '../src/services/repo';

/** Punto de entrada: primera vez → onboarding; después → pantalla principal. */
export default function Index() {
  const [target, setTarget] = useState<'/onboarding' | '/(tabs)' | null>(null);
  useEffect(() => {
    getSetting('onboarded').then((v) => setTarget(v === '1' ? '/(tabs)' : '/onboarding'));
  }, []);
  return target ? <Redirect href={target} /> : null;
}
