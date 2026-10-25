# Auditoría de seguridad de FinZen

Alcance: todo el repositorio (`packages/core`, `packages/db`, `packages/supabase`, `apps/mobile` y el módulo nativo Kotlin), la configuración de Android que realmente se genera y las dependencias.
Método: revisión manual del código con mentalidad de atacante, pruebas automáticas de cada hallazgo, inspección del manifiesto de Android generado por `expo prebuild`, inspección del paquete JS de producción y `npm audit`.

> **Importante:** esta auditoría la hizo quien escribió el código, y no se ha probado todavía en un dispositivo real ni la ha revisado un tercero. Ninguna app es "10/10". Lo honesto es: lo que se pudo verificar sin dispositivo está verificado, y lo demás está listado en [Riesgos residuales](#riesgos-residuales).

## Hallazgos corregidos

| # | Gravedad | Hallazgo | Corrección | Cómo se verificó |
|---|---|---|---|---|
| 1 | Alta | La base de datos estaba **sin cifrar** en el almacenamiento | SQLCipher (AES-256). Clave aleatoria de 256 bits en el almacén seguro (Keystore). Migración automática de la base antigua. Si SQLCipher no estuviera disponible, la app lo detecta (`PRAGMA cipher_version`) y lo avisa en Ajustes en vez de fingir | Código revisado; **pendiente probar en dispositivo** |
| 2 | Alta | Android hacía **copias de seguridad automáticas** de los datos de la app (a Google/adb) | `allowBackup=false` | Manifiesto generado |
| 3 | Alta | Se permitía **tráfico HTTP sin cifrar** en toda la app | `usesCleartextTraffic=false`; Ollama solo por `https://` | Manifiesto generado + validación en código |
| 4 | Alta | El respaldo JSON salía **en claro** (todas las finanzas en Drive/correo) | AES-256-GCM + scrypt, con parámetros autenticados; se rechaza un `N` desmesurado (agotamiento de memoria) | 6 tests: ida y vuelta, contraseña mala, alteración, `N` malicioso, sal/nonce únicos |
| 5 | Alta | **Restaurar un respaldo ajeno** podía cambiar ajustes de dispositivo (p. ej. apuntar la IA al servidor de un atacante, apagar el bloqueo) | Lista cerrada de ajustes (`palette`, `mode`, `onboarded`) con valores validados; tope de tamaño y filas; filas validadas; nombres de columna filtrados contra el esquema | 4 tests |
| 6 | Media | **Suplantación**: una app llamada `com.evil.nequi` pasaba la lista blanca (coincidencia por subcadena) e inyectaba transacciones falsas | Anclaje del paquete exacto con la primera notificación válida; las demás se ignoran y se avisa en pantalla | 3 tests de integración |
| 7 | Media | El filtro de **OTP se podía evadir** con mucho relleno antes de la frase delatora | El descarte de OTP revisa hasta 20 000 caracteres; el análisis y el guardado solo 2 000/300 | Test |
| 8 | Media | **ReDoS**: una regla "regex" (p. ej. de un respaldo) podía congelar la app | Las reglas se tratan siempre como texto plano | Test de tiempo |
| 9 | Media | Entradas gigantes: notificaciones enormes, 10⁹ cuotas, montos de 30 dígitos | Topes en Kotlin (4 000 caracteres), en el pipeline, 1–600 cuotas, montos de máx. 13 dígitos | Tests |
| 10 | Media | El **PIN de 5–6 dígitos** contaba los dígitos parciales como intentos fallidos (bloqueo falso tras 2 intentos) | Se verifica solo al completar la longitud del PIN | Código |
| 11 | Media | **Inyección de fórmulas** en el CSV exportado (`=HYPERLINK(...)` desde un comercio) | Prefijo `'` en celdas que empiezan por `= + - @` | Test |
| 12 | Media | `decode-uri-component@0.2.2` (GHSA-vcc3-ghjq-m6fr): una URL mal formada (enlace profundo) puede congelar la app | Reemplazo lineal propio enlazado desde Metro (el parche oficial es solo ESM y rompía `query-string`) | 120 KB de basura decodificados en 10 ms; verificado que el paquete vulnerable **no** va en el bundle |
| 13 | Media | Permisos innecesarios (almacenamiento, superposición, referido de instalación, detección de capturas) | `blockedPermissions` | Manifiesto generado |
| 14 | Media | Esquema `exp+finzen` del cliente de desarrollo expuesto como enlace profundo | `addGeneratedScheme=false` | Manifiesto generado |
| 15 | Media | **Archivos temporales en claro** (extractos, exportaciones, fotos de recibos) | Se borran al usarlos y al abrir la app; la foto del recibo se borra tras el OCR | Código |
| 16 | Media | "Eliminar todo" **no borraba** PIN, clave de IA, cola/lista del lector, alarmas ni dejaba de sobrescribir páginas | Borrado completo + `secure_delete` + `VACUUM` | Código |
| 17 | Baja | Bitácora de notificaciones sin límite | Máx. 30 días / 500 filas | Test |
| 18 | Baja | `console.*` podría filtrar datos al log del sistema | Eliminados en producción (salvo `error`) | Bundle inspeccionado |
| 19 | Baja | Capturas de pantalla y "apps recientes" mostraban saldos | `FLAG_SECURE` activado por defecto | Código |
| 20 | Baja | Parámetros de enlaces profundos sin validar | Validación y topes | Código |
| 21 | Baja | La voz se enviaba a Google | Reconocimiento en el dispositivo si hay modelo; aviso si no | Código |
| 22 | Baja | Contraseña de nube de 6 caracteres; teclado aprendiendo claves | Mínimo 10; sin autocorrección en campos secretos | Código |
| 23 | Info | `npm audit`: 30 alertas | 29 son herramientas de compilación (Metro, CLI, plugins) que **no van en el APK**; la única de ejecución (nº 12) está mitigada | `npm audit --omit=dev` |

Sin secretos en el código ni en el bundle (se buscaron claves `AIza…`, JWT, `service_role`, llaves privadas).

## Riesgos residuales

Esto es lo que **no** está resuelto o no se pudo comprobar:

1. **Nada probado en un dispositivo real.** Especialmente el cifrado SQLCipher y su migración, el lector de notificaciones y los cambios del PIN. Hasta que se pruebe, trátalo como "revisado, no verificado".
2. **Dispositivo con root o malware con permiso de accesibilidad** puede leer la pantalla o la memoria. Fuera de alcance.
3. **Sincronización (opcional)**: Supabase es un tercero. Los datos viajan por HTTPS y están protegidos por RLS, pero **no están cifrados de extremo a extremo**: el proveedor técnicamente puede leerlos. Si eso no es aceptable, no uses la sincronización (usa el respaldo cifrado).
4. **Actualizaciones OTA sin firma de código.** Quien controle tu cuenta de Expo podría publicar código. Activa verificación en dos pasos en expo.dev. (La firma de código de EAS Update puede requerir un plan de pago: no lo he comprobado.)
5. **Anclaje del paquete = confianza en el primer uso.** Si una app falsa envía la primera notificación válida antes que la real, queda anclada. La pantalla muestra el paquete verificado y permite desvincularlo.
6. **La cola nativa de notificaciones** guarda el texto en claro (almacenamiento privado, sin copias de seguridad, máx. 200 entradas) hasta que la app la vacía.
7. **Biometría no atada a la clave**: la clave de la base vive en el almacén seguro sin exigir huella; el bloqueo es una barrera de interfaz, no de cifrado.
8. **Ofuscación (R8) desactivada**: activarla sin poder probarla podría romper la app.
9. **Bibliotecas comunitarias** (`expo-speech-recognition`, `@react-native-ml-kit/text-recognition`, `react-native-url-polyfill`): no las he auditado por dentro.
10. **El SQL de Supabase** (`packages/supabase/schema.sql`) no se ha ejecutado contra una base real.
11. **Sin pentest externo ni revisión independiente.**

## Calificación

| Área | Antes | Ahora | Qué falta para subir |
|---|---|---|---|
| Datos en reposo | 3 | 8 | Probar en dispositivo; atar la clave a la biometría |
| Datos en tránsito | 5 | 9 | Fijar certificados (poco práctico aquí) |
| Entradas no confiables (notificaciones, archivos, enlaces) | 4 | 9 | — |
| Control de acceso / bloqueo | 5 | 8 | Biometría criptográfica |
| Privacidad (IA, voz, logs, temporales) | 5 | 8 | Cifrado de extremo a extremo en la sincronización |
| Cadena de suministro | 5 | 7 | Firma de OTA, revisión de bibliotecas comunitarias |
| **Global (estimación honesta)** | **~4** | **~8 / 10** | Pruebas en dispositivo y una revisión independiente |
