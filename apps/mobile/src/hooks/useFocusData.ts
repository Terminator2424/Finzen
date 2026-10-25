import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Carga datos cada vez que la pantalla gana foco (así al volver de "nueva transacción"
 * la lista ya viene actualizada). Devuelve [datos, recargar].
 */
export function useFocusData<T>(loader: () => Promise<T>, initial: T): [T, () => void] {
  const [data, setData] = useState<T>(initial);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    loaderRef.current().then(setData).catch((e) => console.warn('useFocusData', e));
  }, []);

  useFocusEffect(reload);
  return [data, reload];
}
