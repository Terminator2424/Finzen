# Seguridad de FinZen

Informe completo de la auditoría: [docs/AUDITORIA_SEGURIDAD.md](docs/AUDITORIA_SEGURIDAD.md).

## Qué se protege
Saldos, transacciones, deudas, texto de notificaciones bancarias, el PIN y las claves de IA/nube.

## Modelo de amenazas

| # | Amenaza | Mitigación |
|---|---|---|
| 1 | Robo o pérdida del celular | Base de datos cifrada (SQLCipher AES-256, clave en el Keystore), bloqueo con huella + PIN con espera creciente tras 5 fallos, bloqueo automático, pantalla protegida de capturas y de "apps recientes" |
| 2 | Que la app lea claves de un solo uso | Lista blanca por paquete **antes** de leer el texto (Kotlin), descarte de OTP en Kotlin y en TypeScript (con escaneo ampliado contra relleno), el texto descartado nunca se guarda |
| 3 | Números de tarjeta/cuenta/teléfono/correo en disco o en la nube | Enmascarado a los últimos 4 dígitos antes de guardar, registrar o sincronizar |
| 4 | Apps falsas que imitan a un banco | Anclaje del paquete exacto en el primer uso; las impostoras se ignoran y se muestran en pantalla |
| 5 | Copias de seguridad / archivos filtrados | `allowBackup=false`; respaldo JSON siempre cifrado (AES-256-GCM + scrypt); archivos temporales borrados al usarlos |
| 6 | Archivos o enlaces maliciosos (CSV, respaldo, deep link) | Topes de tamaño, validación de filas, lista cerrada de ajustes restaurables, reglas siempre como texto plano, decodificador de URLs lineal, parámetros validados, anti-inyección de fórmulas en CSV |
| 7 | Espionaje de red | Todo el tráfico es HTTPS; el tráfico en claro está bloqueado a nivel de sistema |
| 8 | Un usuario ve datos de otro en la nube | Row Level Security (`user_id = auth.uid()`), trigger de "última escritura gana", solo la clave `anon` en la app |
| 9 | Datos enviados a una IA | Solo totales anonimizados (sin nombres de cuentas, bancos ni comercios); clave de IA solo en el almacén seguro; Ollama solo por HTTPS |
| 10 | Secretos en el repositorio | `.gitignore` (`.env`, `*.db`, llaves), barrido automático de patrones de secretos |

## Fuera de alcance
Dispositivos con root, malware con permiso de accesibilidad y compromiso de tus cuentas de Google, Expo o Supabase (activa verificación en dos pasos en todas).

## Reportar una vulnerabilidad
Abre un aviso privado o contacta al autor. No publiques detalles hasta que haya corrección.
