# Arquitectura de FinZen

## Principios
1. **Offline-first**: SQLite local es la fuente de verdad; la nube es respaldo/sincronización.
2. **Lógica compartida en TypeScript** (`packages/core`) sin dependencias de plataforma → la usan la app móvil y la de escritorio, y se prueba con Vitest sin emulador.
3. **Seguridad por defecto**: ante la duda, descartar (ver `SECURITY.md`).
4. **Todo gratis**: ningún componente exige tarjeta de crédito.

## Paquetes
| Paquete | Qué contiene | Estado |
|---|---|---|
| `packages/db` | Esquema SQLite, migraciones, semillas, runner | ✅ paso 1 |
| `packages/core` | Cálculo de cuotas, pipeline de notificaciones | ✅ paso 1 |
| `apps/mobile` | Expo / React Native (Android) + módulo Kotlin de notificaciones | ✅ |
| `packages/supabase` | SQL con RLS (la sincronización opcional vive en `apps/mobile/src/services/sync.ts`) | ✅ |
| ~~`apps/desktop`~~ | Descartado: la app es 100 % del celular. El PC solo sirve para respaldos (exportar JSON/CSV) y, opcionalmente, para correr Ollama | — |

## Flujo de una compra a crédito (Addi, Sistecrédito, tarjeta)
```
Notificación Android
  → [Kotlin] lista blanca (si no está, ni sube a JS)
  → [core] descarte OTP → enmascarado → parseo
  → transacción status='needs_installments', payment_method='bnpl'|'credit'
  → al abrir la app: tarjeta "¿En cuántas cuotas fue la compra de $300.000 en Falabella?"
        usuario elige n y UNA de estas tres vías:
          a) escribe la cuota que ve en Addi  → solveMonthlyRate() deduce la tasa
          b) escribe la tasa E.A.             → monthlyRateFromEA()
          c) "sin intereses" (+ cargo fijo opcional por cuota)
  → buildSchedule() → se crea la deuda (debts) + calendario (debt_installments)
  → la transacción queda 'posted' con debt_id
  → se programan avisos locales de cada vencimiento
```
Cuando llega "Pagaste tu cuota de Addi" el parser marca `isDebtPayment` y **no** pregunta cuotas: marca la cuota como pagada.

> La aritmética de cuotas es 100 % determinista. **No se usa IA para calcular dinero.**

## Decisión: ¿IA local o IA gratuita en la nube?
Como el teléfono tiene internet, se soportan ambas detrás de una misma interfaz `AiProvider` (paso 7), en este orden de preferencia:

1. **Ollama** (PC, red local): máxima privacidad. Requiere PC encendida.
2. **Gemini API, nivel gratuito** (clave de Google AI Studio, ya tienes cuenta Google): funciona desde el celular en cualquier parte. Los límites y condiciones del nivel gratuito cambian; revisarlos al integrarlo. Regla: el plan gratuito de un proveedor puede usar los datos para mejorar sus productos, así que **solo se envían agregados anonimizados** (totales por categoría, sin comercios, nombres ni números).
3. **Sin IA**: reglas de categorización y cálculos siguen funcionando.

La clave de Gemini va en el dispositivo (`settings` scope `device`), nunca en el repo ni en Supabase.

## Decisión: avisos y correos
- **Recordatorios de cuotas y alertas de presupuesto → notificaciones locales** (`expo-notifications`, programadas en el teléfono). Gratis, sin servidor, funcionan offline. Es la opción por defecto.
- **Correo opcional (resumen semanal, alerta de vencimiento)**: *Google Apps Script* publicado como web-app bajo tu cuenta de Google (como en tu proyecto anterior). Gratis y sin servidor; tiene cuota diaria de envíos baja en cuentas personales, suficiente para un resumen. Se hará en un paso posterior solo si lo quieres.

## Decisión: sincronización
Supabase (plan gratuito) + RLS por `auth.uid()`. Resolución "última escritura gana" por `updated_at`; borrado lógico con `deleted_at`. Solo se sincronizan las tablas de `SYNCED_TABLES`; `notifications_log`, `notification_sources`, `sync_queue` y los ajustes `scope='device'` son locales. El plan gratuito pausa proyectos inactivos durante semanas: la app debe tolerarlo (cola local, reintentos).

## Convenciones de datos
- Dinero: `INTEGER` en pesos. Tasas: `REAL` como proporción (0.02 = 2 %).
- Fechas de evento: epoch ms UTC. Vencimientos: `'YYYY-MM-DD'`.
- IDs: UUID generado en el cliente.

## Independencia del PC
- El APK de `preview`/`production` lleva el código JavaScript **dentro**: no se conecta a ningún servidor de desarrollo (a diferencia del cliente de desarrollo, que carga el código desde el PC y se queda en blanco sin él).
- Los datos viven en SQLite en el celular. Respaldo: exportar JSON/CSV o sincronizar con Supabase (opcional).
- Único uso opcional del PC: ejecutar Ollama como IA local.

## Lectura de notificaciones (Android)
`modules/finzen-notifications` es un módulo local de Expo con un `NotificationListenerService`:
1. **Kotlin** (antes de que algo llegue a JS): lista blanca por `packageName` → descarte de OTP → cola privada (SharedPreferences).
2. **TypeScript** (`listener.ts` → `@finzen/core`): vacía la cola, enmascara, interpreta y guarda; el texto original se borra al vaciar la cola.
3. Si es una compra a crédito queda `needs_installments` y se avisa con una notificación local.
Limitación: el servicio captura aunque la app esté cerrada, pero se procesa al abrir la app (o cuando está en primer plano).
