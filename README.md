# FinZen - Gestor de Finanzas Personales Offline-First

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Expo](https://img.shields.io/badge/Expo-1B1B1B?style=for-the-badge&logo=expo&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

FinZen es una aplicación móvil de finanzas personales diseñada bajo el paradigma **Offline-First** (funciona sin conexión a internet). Su objetivo es ofrecer un control absoluto, privado y seguro sobre el dinero, eliminando la dependencia de servidores externos y evitando el envío de datos sensibles a la nube.

## Características

*   **Seguridad avanzada:** base de datos local cifrada con SQLCipher (AES-256), bloqueo por PIN/biometría y bloqueo de capturas de pantalla.
*   **Lectura de notificaciones (Android):** un módulo nativo en Kotlin lee las notificaciones de las apps de pago que tú elijas, descarta OTPs, enmascara números sensibles y registra el movimiento automáticamente. Ver [Lectura de notificaciones](#lectura-de-notificaciones).
*   **Bandeja de borradores:** si una notificación no coincide con ningún formato conocido, no se pierde: queda en "Borradores" para revisión manual.
*   **Gestión financiera:** cálculo determinista (método francés) para tarjetas de crédito, compras a cuotas (Addi, Sistecrédito) y préstamos. Incluye simulador de abono extra y método avalancha.
*   **Dashboard y presupuestos:** patrimonio neto, gastos por categoría, proyección de gastos fijos y presupuestos mensuales.
*   **Edición transaccional:** al editar un movimiento pasado se revierte el efecto anterior y se aplica el nuevo sobre el saldo de las cuentas.
*   **Asistente IA (opcional):** integración con Ollama (local) o Gemini. Solo se envían datos anonimizados (sin nombres de bancos, comercios ni fechas exactas).
*   **Portabilidad:** respaldos cifrados en JSON y exportación a CSV (con protección contra inyección de fórmulas).

## Lectura de notificaciones

Es la función central de la app y solo funciona en Android.

### Cómo funciona

```text
Notificación de Android
  -> servicio nativo (Kotlin): lista blanca de apps + descarte de OTP
  -> cola cifrada con Android Keystore
  -> puente JS: lee la cola SIN borrarla
  -> @finzen/core: descarte de OTP, enmascarado, interpretación
  -> SQLite cifrada: se crea el movimiento y solo entonces se confirma (ack) la cola
```

Principios de diseño:

*   **Lista blanca, sin apps por defecto.** FinZen no lee nada hasta que tú agregas una app con el Modo Aprendizaje. Del resto de apps no se lee ni el título ni el texto.
*   **Vinculación al paquete exacto.** La primera notificación válida de una fuente fija su paquete; una app falsa con nombre parecido no puede hacerse pasar por ella.
*   **Los códigos y claves nunca se guardan.** Los OTP se descartan en el servicio nativo, antes de que nada llegue a JavaScript.
*   **Nada se guarda sin enmascarar.** Tarjetas, cuentas, celulares y correos se enmascaran antes de registrar nada.
*   **No se pierde nada si la app se cae.** La cola se cifra con una clave del Keystore y solo se borra cuando el movimiento ya está guardado.
*   **Autorreparación.** El lector se vuelve a enlazar solo si el sistema lo suelta (al desconectarse, al abrir la app, tras reiniciar el teléfono y con un vigilante periódico).

### Activarlo, paso a paso

1.  Instala el APK.
2.  Abre **Lectura de notificaciones** y toca **Abrir ajustes de acceso**. Activa FinZen.
3.  Si el interruptor sale gris (Android 13 o superior), abre la información de la app, toca los tres puntos y elige **Permitir ajustes restringidos**. Luego repite el paso 2.
4.  Quita la restricción de batería de FinZen. En Samsung, Xiaomi, Motorola y Huawei esto es obligatorio para que el sistema no congele el lector (instrucciones por marca en <https://dontkillmyapp.com>).
5.  Activa el **Modo Aprendizaje**, haz una operación en tu banco y toca **Agregar** en la app que aparezca. Desde ese momento se sincroniza y se lee sola.
6.  Comprueba que el estado diga **🟢 Conectado**.

La app trae la misma guía en **Lectura de notificaciones > Guía paso a paso**, un probador de texto y un diagnóstico técnico.

### Apps compatibles

| App | Estado | Notas |
|---|---|---|
| Nu (`com.nu.production`) | ✅ Verificada | Probado con notificaciones reales de gasto ("Enviaste $X"). |
| Nequi (`com.nequi.MobileApp`) | ✅ Verificada | Probado con ingresos por Bre-B ("Te enviaron $X"). |
| Addi y Sistecrédito (por WhatsApp) | ✅ Verificadas | Ver la nota de WhatsApp. |
| Otros bancos y billeteras | 🧪 Experimental | Se agregan con el Modo Aprendizaje. Si el formato no se reconoce, la notificación va a Borradores. Ver [Contribuir](#contribuir). |

### WhatsApp

Addi y Sistecrédito avisan sus compras y cuotas por WhatsApp. Si agregas `com.whatsapp`, FinZen solo procesa **chats individuales cuyo remitente sea Addi o Sistecrédito**; los grupos y cualquier otro chat se descartan sin leerse. Como el nombre de un contacto lo puede escribir cualquiera, existe la opción **Verificar remitente**, que fija el remitente al primer chat válido y bloquea suplantaciones.

### Limitaciones conocidas

*   Solo Android. iOS no permite leer notificaciones de otras apps.
*   Si una notificación no incluye el monto (algunos bancos solo avisan "tienes un movimiento"), no hay nada que interpretar.
*   Los SMS todavía no se leen.

## Arquitectura del proyecto

Monorepo con NPM Workspaces:

*   `packages/core`: lógica pura en TypeScript. Parsers (notificaciones, voz, OCR), matemáticas financieras (cuotas, tasas) y criptografía. Sin dependencias de React Native.
*   `packages/db`: esquema SQLite, migraciones versionadas y semillas.
*   `packages/supabase`: esquema SQL opcional para sincronización en la nube (con políticas RLS).
*   `apps/mobile`: aplicación Expo/React Native. Incluye el módulo nativo Kotlin `finzen-notifications`.

## Seguridad y privacidad

1.  **Local-first:** los datos no salen del dispositivo a menos que el usuario lo autorice.
2.  **Cifrado en reposo:** SQLite cifrada con SQLCipher; la clave vive en el Keystore de Android.
3.  **Cifrado de respaldos:** AES-256-GCM con derivación de claves scrypt.
4.  **Cola de notificaciones cifrada** con una clave del Keystore que no entra en respaldos (`allowBackup` desactivado).
5.  **Restauración no confiable:** un respaldo no puede activar fuentes de notificaciones, cambiar ajustes del dispositivo ni traer patrones peligrosos.
6.  **Supabase (opcional):** los datos viajan por HTTPS, pero Supabase no implementa cifrado de extremo a extremo. Para privacidad absoluta, usa solo los respaldos locales cifrados y deja la nube desactivada.

## Instalación y desarrollo

### Prerrequisitos

*   Node.js v18 o superior
*   Cuenta en [Expo](https://expo.dev) (para compilar con EAS)
*   Android Studio, solo si compilas en local el módulo nativo

### Pasos

```bash
git clone https://github.com/Terminator2424/Finzen.git
cd Finzen
npm install
npm run test --workspaces --if-present
```

Compilar un APK en la nube:

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

Los cambios en el módulo Kotlin requieren un APK nuevo; los cambios solo de JavaScript no.

## Contribuir

### Agregar el formato de un banco

1.  Copia el texto de la notificación desde **Borradores** (ya viene enmascarado). Nunca publiques una notificación sin enmascarar: nombres, números de cuenta y celulares son datos personales.
2.  Agrega un caso en `packages/core/src/notifications/notifications.test.ts`.
3.  Ajusta `packages/core/src/notifications/parse.ts` hasta que el test pase.
4.  Ejecuta `npm run test --workspaces --if-present` y abre un pull request.

## Hoja de ruta

*   Abonar automáticamente los pagos de tarjeta a la tarjeta correcta (por app o preguntando cuál).
*   Leer SMS de facturas y crear recordatorios de pago con fecha límite.
*   Confirmación manual para movimientos leídos desde WhatsApp.
*   Modo demo con datos de ejemplo.