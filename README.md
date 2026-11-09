# FinZen

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Expo](https://img.shields.io/badge/Expo-1B1B1B?style=for-the-badge&logo=expo&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

FinZen es una aplicación móvil de finanzas personales para Android, diseñada bajo el paradigma **offline-first**: funciona sin conexión a internet, guarda todo en una base de datos cifrada en el propio celular y no depende de servidores externos. Su función central es registrar los movimientos de forma automática leyendo las notificaciones de las apps de pago, con filtros de seguridad que descartan códigos de un solo uso y enmascaran los datos sensibles antes de guardar nada.

Versión actual: 1.0.0. Licencia MIT.

## Contenido

*   [Funciones](#funciones)
*   [Lectura de notificaciones](#lectura-de-notificaciones)
*   [Limitaciones conocidas](#limitaciones-conocidas)
*   [Arquitectura del proyecto](#arquitectura-del-proyecto)
*   [Seguridad y privacidad](#seguridad-y-privacidad)
*   [Instalación y desarrollo](#instalación-y-desarrollo)
*   [Pruebas](#pruebas)
*   [Contribuir](#contribuir)
*   [Hoja de ruta](#hoja-de-ruta)
*   [Licencia](#licencia)

## Funciones

### Captura automática de movimientos

*   Lee las notificaciones de las apps de pago que tú elijas y registra el movimiento sin intervención. Ver [Lectura de notificaciones](#lectura-de-notificaciones).
*   Bandeja de **Borradores**: si un aviso no coincide con ningún formato conocido, no se pierde; queda para revisión manual.
*   **Deshacer**: cuando FinZen registra algo solo, avisa con una notificación con botón Deshacer. Además, Inicio muestra durante 12 horas lo registrado automáticamente, también con Deshacer. Deshacer devuelve el saldo y el mismo aviso no se vuelve a importar.
*   **Remitentes y avisos**: pantalla para editar los remitentes permitidos de los SMS, y para activar o apagar las confirmaciones.

### Cuentas, movimientos y reportes

*   Cuentas de varios tipos (ahorros, corriente, efectivo, billetera digital, inversión) cuyo saldo se mueve con cada movimiento. El ajuste de saldo deja un movimiento de ajuste en el historial.
*   Registro manual, dictado por voz, lectura de recibos con la cámara e importación de extractos en CSV.
*   Categorización automática por reglas y presupuestos mensuales con alertas.
*   Edición transaccional: al editar un movimiento pasado se revierte el efecto anterior y se aplica el nuevo sobre el saldo de las cuentas.
*   **Transferencias entre tus propias cuentas** (por ejemplo, de Nu a Nequi): no cuentan como ingreso ni como gasto del mes. Se emparejan solas a partir de las notificaciones o se registran a mano.
*   Gastos fijos y suscripciones, con recordatorio un día antes del pago.
*   Inicio con patrimonio neto, evolución mensual, ingresos y gastos del mes, gastos por categoría, presupuestos y próximos pagos.
*   Aviso en Inicio cuando hay movimientos leídos que no cayeron en ninguna cuenta, para que no pasen desapercibidos.

### Deudas y tarjetas

*   Tarjetas de crédito con cupo, día de corte y de pago, y utilización del cupo.
*   Compras a cuotas (Addi, Sistecrédito, créditos y compras diferidas con tarjeta) con tabla de amortización calculada de forma determinista (método francés) y cargos fijos por cuota.
*   Simulador de abono extra y método avalancha para decidir a qué deuda abonar primero.
*   Recordatorios de pago: un día antes y el mismo día para las deudas con día de pago (tarjetas y cuotas ya tienen sus propios avisos).
*   **Ajustar deudas**: desde Deudas, cada tarjeta tiene un enlace Ajustar.
    *   Me prestaron más (en tarjetas, Gasté más): suma al saldo.
    *   Pagué: baja el saldo y queda como pago de deuda, en efectivo o en persona (no toca cuentas) o desde una cuenta (se descuenta de ella). Si el saldo llega a cero, la deuda se cierra.
    *   Corregir a la baja: baja el saldo sin mover dinero.
    *   En las tarjetas también se puede cambiar el cupo.
    *   Cada ajuste queda en un historial.
    *   Si te descontaron dinero en un gasto que en realidad era el pago de una deuda, en Ajustar aparece la lista de tus gastos recientes: al tocar uno se convierte en pago, baja la deuda, deja de contarse como gasto del mes y la cuenta no se vuelve a mover.
*   Los planes con calendario de cuotas no admiten cambiar el saldo suelto, porque se descuadrarían de la tabla de cuotas: ahí se marca la cuota como pagada.

### Me deben (cuentas por cobrar)

Anota quién te debe plata, cuánto y cuándo te paga (Ajustes → Me deben).

*   Cada cobro muestra lo que falta, una barra de progreso y la fecha de pago (en rojo si ya venció). Admite pagos parciales.
*   Recordatorio el día en que te toca cobrar.
*   Mientras no te paguen, lo que te deben cuenta como un activo del patrimonio. No cambia el saldo de tus cuentas: el dinero entra y sale por las notificaciones o los movimientos de siempre, así no se cuenta dos veces.
*   Pagos detectados: cuando entra un ingreso por notificación que nombra a alguien de la lista y no supera lo que debe, FinZen propone "¿te pagó?". Al aceptar, descuenta el cobro y ese ingreso queda como cobro de deuda, no como ingreso del mes. Solo propone si coincide una única deuda.
*   Los nombres se guardan solo en el celular, entran en el respaldo cifrado y no se envían a la IA.

### Asistente de IA (opcional)

Responde preguntas sobre tus finanzas con **Gemini** (nube, nivel gratuito de Google AI Studio) o con **Ollama** (en tu propio equipo). A cualquiera de los dos solo se le envían totales anonimizados: nunca nombres de cuentas, bancos, comercios ni personas. La clave de Gemini se guarda en el almacén seguro del celular (Keystore), no en el repositorio ni en la nube.

*   **Modelo automático.** Por defecto la app elige el modelo Flash más reciente disponible para tu clave y, si falla, prueba otros. Puedes fijar uno a mano; si ese modelo deja de servir, la app vuelve a automático y te avisa. Hay un botón para restablecer a automático.
*   **Respuestas en texto plano.** Se le pide a la IA un formato apto para el celular y la app limpia cualquier símbolo de Markdown que llegue igual.
*   **Errores claros.** "Guardar y probar" hace una llamada real y, si falla, muestra el código y el motivo que devolvió el proveedor, con un botón para compartir ese detalle sin incluir la clave.
*   **Claves de Google.** AI Studio crea claves de autorización que empiezan por `AQ.`. Según la documentación de Google, las claves estándar (`AIza`) sin restricciones dejaron de aceptarse el 19 de junio de 2026 y todas las estándar se rechazan desde septiembre de 2026.

### Respaldos y portabilidad

*   Respaldo completo cifrado con contraseña (AES-256-GCM con derivación de claves scrypt). Incluye cuentas, movimientos, deudas, cuotas, presupuestos, gastos fijos, cobros y el historial de ajustes de deudas.
*   FinZen guarda la fecha del último respaldo, la muestra en Ajustes y avisa si nunca hiciste uno o si pasaron 30 días.
*   Exportación de movimientos a CSV con protección contra inyección de fórmulas. El CSV **no** está cifrado.
*   Borrado total de datos desde Ajustes: elimina datos, PIN, claves de IA y de sincronización, cola del lector y avisos programados.

### Modo demo

Ajustes → Modo demo carga cuentas, movimientos, una tarjeta, deudas y cobros de ejemplo para grabar un video o tomar capturas sin mostrar finanzas reales. Solo se carga con la base de datos vacía (haz un respaldo cifrado, borra los datos, carga la demo y, al terminar, restaura el respaldo), no se sincroniza con la nube y se puede quitar sin tocar nada real. Incluye un interruptor para permitir capturas y grabación, que la app bloquea por defecto.

## Lectura de notificaciones

Es la función central de la app y solo funciona en Android.

### Cómo funciona

```text
Notificación de Android
  -> servicio nativo (Kotlin): lista blanca de apps + reglas de remitente + descarte de OTP
  -> cola cifrada con Android Keystore
  -> puente JS: lee la cola SIN borrarla
  -> @finzen/core: descarte de OTP, enmascarado, interpretación
  -> SQLite cifrada: se crea el movimiento y solo entonces se confirma (ack) la cola
```

### Principios de diseño

*   **Lista blanca, sin apps por defecto.** FinZen no lee nada hasta que tú agregas una app con el Modo Aprendizaje. Del resto de apps no se lee ni el título ni el texto.
*   **Vinculación al paquete exacto.** La primera notificación válida de una fuente fija su paquete; una app falsa con nombre parecido no puede hacerse pasar por ella.
*   **Los códigos y claves nunca se guardan.** Los OTP se descartan en el servicio nativo, antes de que nada llegue a JavaScript.
*   **Nada se guarda sin enmascarar.** Tarjetas, cuentas, celulares y correos se enmascaran antes de registrar nada.
*   **No se pierde nada si la app se cae.** La cola se cifra con una clave del Keystore y solo se borra cuando el movimiento ya está guardado.
*   **Autorreparación.** El lector se vuelve a enlazar solo si el sistema lo suelta (al desconectarse, al abrir la app, tras reiniciar el teléfono y con un vigilante periódico). Si no logra reconectar, avisa con una notificación.

### Activarlo, paso a paso

1.  Instala el APK.
2.  Abre **Lectura de notificaciones** y toca **Abrir ajustes de acceso**. Activa FinZen.
3.  Si el interruptor sale gris (Android 13 o superior), abre la información de la app, toca los tres puntos y elige **Permitir ajustes restringidos**. Luego repite el paso 2.
4.  Quita la restricción de batería de FinZen. En Samsung, Xiaomi, Motorola y Huawei esto es obligatorio para que el sistema no congele el lector (instrucciones por marca en <https://dontkillmyapp.com>).
5.  Activa el **Modo Aprendizaje**, haz una operación en tu banco y toca **Agregar** en la app que aparezca. Desde ese momento se sincroniza y se lee sola.
6.  Comprueba que el estado del lector diga **Conectado**.
7.  Escribe tu nombre cuando la app lo pida: sirve para reconocer las transferencias entre tus cuentas.

La app trae la misma guía en **Lectura de notificaciones > Guía paso a paso**, un probador de texto y un diagnóstico técnico.

### Apps compatibles

| App | Estado | Notas |
|---|---|---|
| Nu (`com.nu.production`) | Verificada | Gasto ("Enviaste $X") y pago de tarjeta de crédito, con textos reales. Aviso al recibir dinero: sin verificar. |
| Nequi (`com.nequi.MobileApp`) | Verificada | Ingresos por Bre-B ("Te enviaron $X") y envíos de personas ("Nombre te envió X"), con textos reales. Avisos al enviar dinero: sin verificar. |
| Addi (pagos por PSE) | Verificado | El aviso del banco ("Pago aprobado ... P.A. ADDI") marca la cuota de Addi como pagada. FinZen no lee WhatsApp. |
| Tigo (SMS, por Google Messages o Samsung Messages) | Experimental | Avisos de factura. Formato verificado con un SMS real; falta la prueba en vivo. |
| BBVA Colombia | Experimental | Recibir y enviar por Bre-B (llave) con textos reales; los pagos rechazados se ignoran. Hay que agregar la app con el Modo Aprendizaje. |
| DaviPlata | Experimental | Envíos por Llaves ("Pasaste $X a ..."). El aviso al recibir no trae el monto y queda en Borradores. |
| Otros bancos y billeteras | Experimental | Se agregan con el Modo Aprendizaje. Si el formato no se reconoce, el aviso va a Borradores. Ver [Contribuir](#contribuir). |

### SMS de facturas (experimental)

Si agregas tu app de mensajes (`com.google.android.apps.messages` o `com.samsung.android.messaging`), FinZen solo lee los SMS de los remitentes permitidos (por defecto, Tigo) y descarta todo lo demás sin leerlo. Un aviso como "Ya generamos tu factura de OCTUBRE ... por $19.900, límite de pago 21/11/2026" no es un gasto: se guarda como pago recurrente con su día de vencimiento y un recordatorio un día antes. La publicidad se ignora.

### Remitentes permitidos (SMS)

En Lectura de notificaciones > Remitentes y avisos se pueden editar los remitentes permitidos de los SMS (por defecto, Tigo). Un remitente es una sola palabra: la primera del título del aviso. Los paquetes de mensajes nunca quedan sin regla: si quitas todos los remitentes, no se lee nada de esa app.

### Pagos de tarjeta de crédito

Cuando llega un aviso como "Pagaste tu tarjeta de crédito Nu", FinZen lo registra como **abono a la tarjeta**: baja su saldo, descuenta el dinero de la cuenta de esa app (por ejemplo, la cuenta "Nu") y queda en la categoría Deudas, no como un gasto más. La tarjeta y la cuenta se enlazan por el nombre de la app: una tarjeta (o proveedor) llamada "Nu" y una cuenta llamada "Nu" se asocian solas con la app Nu. Si no hay una única tarjeta que calce, el aviso va a **Borradores**: al tocar "Procesar" se abre el formulario **Abono a deuda** con el monto ya puesto y solo eliges la deuda y la cuenta.

### Pagos por PSE y avisos que no son movimientos

Cuando pagas una cuota por PSE (por ejemplo, Addi desde Nu), el banco manda dos avisos: "Tienes un pago por $X de P.A. ADDI" (el pago está por hacer) y, más tarde, "Pago aprobado por $X". FinZen ignora el primero, porque todavía no es un movimiento, y con el segundo marca la cuota de Addi como pagada en lugar de registrar un gasto suelto: baja la deuda y descuenta de la cuenta del banco. La cuota se busca por su valor (con un peso de margen) entre las deudas cuyo proveedor aparece en el aviso. Si el mismo pago llega por otro aviso, no se cuenta dos veces. Los avisos de pagos rechazados también se ignoran, porque no mueven dinero.
### Transferencias entre tus propias cuentas

Si mueves dinero entre dos cuentas tuyas (por ejemplo, de Nu a Nequi), cada app avisa por separado: Nu un gasto y Nequi un ingreso. FinZen empareja las dos notificaciones cuando tienen el mismo monto, son de cuentas distintas y llegan con menos de 10 minutos de diferencia, y las guarda como una **transferencia**: los saldos cambian, pero no cuenta como ingreso ni como gasto del mes. Si hay más de una pareja posible, no adivina. También puedes registrar una transferencia a mano en Ajustes > Transferir entre mis cuentas, y al borrar una mitad se borran las dos.

**Verificación de nombre.** Para no confundir movimientos distintos (por ejemplo, un amigo te envía $30.000 y tú envías $30.000 a otra persona), solo se empareja si el aviso de alguna de las dos mitades te nombra a ti. Nu muestra tu nombre enmascarado (`EDI***** JAV*****`) y FinZen lo compara con el nombre que guardas; Nequi muestra el nombre completo, a veces con menos palabras, por eso el nombre admite varias versiones separadas por punto y coma (por ejemplo, `Juan Carlos Perez Gomez; Juan Perez`). Se exigen al menos tres coincidencias, o todas si la versión tiene menos de tres palabras. El nombre se guarda solo en el celular y no se sincroniza. Sin nombre guardado no se empareja solo: usa la transferencia manual.

## Limitaciones conocidas

*   **Solo Android.** iOS no permite leer notificaciones de otras apps.
*   **El aviso debe traer el monto.** Si una notificación no lo incluye (algunos bancos solo avisan "tienes un movimiento"), no hay nada que interpretar. El motor trabaja en pesos enteros y descarta montos menores a un peso.
*   **La importación necesita la app en ejecución.** El servicio nativo captura los avisos aunque la app esté cerrada y los guarda cifrados, pero convertirlos en movimientos y actualizar saldos lo hace la parte de JavaScript. Si el sistema cierra la app, los avisos esperan en la cola hasta que se abra. En algunas marcas hay que quitar la restricción de batería para que el lector no se congele.
*   **Formatos verificados limitados.** Los avisos de Nequi al enviar dinero y de Nu al recibirlo todavía no están verificados con textos reales. Cualquier otra app es experimental.
*   **SMS solo de remitentes permitidos,** y cada remitente es una sola palabra. **FinZen no lee WhatsApp:** nunca funcionó de forma confiable y exponía chats personales; los pagos de Addi se registran con el aviso del banco (PSE).
*   **Movimientos sin cuenta.** Si no existe una cuenta con el nombre de la app (por ejemplo "Nu" o "Nequi"), el movimiento se guarda pero no mueve ningún saldo. Inicio lo avisa. Crear la cuenta después no reasigna los movimientos anteriores.
*   **Transferencias automáticas.** Requieren el nombre guardado, que ambos avisos vengan de notificaciones y que lleguen con menos de 10 minutos de diferencia. Un familiar con los mismos apellidos y un nombre de pila parecido podría confundirse contigo; la transferencia manual evita ese caso.
*   **Abonos automáticos.** El abono por notificación solo aplica a tarjetas de crédito. Las cuotas de planes se marcan por su valor (con un peso de margen) y solo si hay una única deuda candidata.
*   **Planes con calendario de cuotas** no admiten ajustar el saldo suelto; se marca la cuota como pagada.
*   **Me deben y ajustes de deuda son locales:** no se sincronizan con la nube (sí entran en el respaldo cifrado). Los pagos detectados solo miran ingresos de los últimos 7 días (la bitácora de notificaciones se poda a los 7 días), y borrar el ingreso aceptado no reabre el cobro.
*   **Las confirmaciones muestran el monto** en la pantalla bloqueada. Se pueden apagar en Remitentes y avisos.
*   **El modo demo** solo se carga con la base de datos vacía.
*   **El respaldo es el único seguro.** La clave de cifrado vive en el Keystore del celular: si pierdes el teléfono o desinstalas la app sin respaldo, los datos no se recuperan. El CSV no está cifrado.
*   **La IA es opcional** y depende de los límites y del estado de la API del proveedor.

## Arquitectura del proyecto

Monorepo con NPM Workspaces:

*   `packages/core`: lógica pura en TypeScript. Parsers (notificaciones, voz, OCR), matemáticas financieras (cuotas, tasas), reconocimiento del nombre del usuario, limpieza de respuestas de la IA y criptografía. Sin dependencias de React Native.
*   `packages/db`: esquema SQLite, migraciones versionadas (001 a 007) y semillas.
*   `packages/supabase`: esquema SQL opcional para sincronización en la nube (con políticas RLS).
*   `apps/mobile`: aplicación Expo/React Native. Incluye el módulo nativo Kotlin `finzen-notifications`.

## Seguridad y privacidad

1.  **Local-first:** los datos no salen del dispositivo a menos que el usuario lo autorice.
2.  **Cifrado en reposo:** SQLite cifrada con SQLCipher (AES-256); la clave vive en el Keystore de Android.
3.  **Bloqueo de la app:** PIN con espera creciente tras cinco fallos y biometría; la pantalla se protege de capturas y de la vista de aplicaciones recientes.
4.  **Cifrado de respaldos:** AES-256-GCM con derivación de claves scrypt.
5.  **Cola de notificaciones cifrada** con una clave del Keystore que no entra en respaldos (`allowBackup` desactivado).
6.  **Filtros antes de leer:** lista blanca por paquete y por remitente, descarte de OTP (códigos, PIN, CVV y frases de advertencia) y enmascarado de tarjetas, cuentas, celulares y correos antes de guardar.
7.  **Restauración no confiable:** un respaldo no puede activar fuentes de notificaciones, cambiar ajustes del dispositivo ni traer patrones peligrosos; solo se restauran ajustes de una lista cerrada.
8.  **Datos enviados a una IA:** solo totales anonimizados; la clave se guarda en el almacén seguro.
9.  **Red:** todo el tráfico es HTTPS y el tráfico en claro está bloqueado a nivel de sistema.
10. **Supabase (opcional):** los datos viajan por HTTPS, pero Supabase no implementa cifrado de extremo a extremo. Para privacidad absoluta, usa solo los respaldos locales cifrados y deja la nube desactivada.

Fuera de alcance: dispositivos con root, malware con permiso de accesibilidad y compromiso de tus cuentas de Google, Expo o Supabase (activa la verificación en dos pasos en todas).

## Instalación y desarrollo

### Prerrequisitos

*   Node.js 22.13 o superior (las pruebas usan `node:sqlite`; el CI corre con Node 24).
*   Cuenta en [Expo](https://expo.dev) para compilar con EAS.
*   Android Studio, solo si compilas en local el módulo nativo.

### Pasos

```bash
git clone https://github.com/Terminator2424/Finzen.git
cd Finzen
npm install
npm run test --workspaces --if-present
```

### Compilar un APK

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
```

El perfil `preview` genera un APK instalable. Para instalarlo encima de una versión anterior, sube `android.versionCode` en `apps/mobile/app.json`: Android no actualiza con un número igual o menor. Los enlaces de descarga de Expo caducan; guarda el APK si quieres conservarlo.

### Actualizaciones por aire

Los cambios solo de JavaScript no necesitan un APK nuevo:

```bash
cd apps/mobile
npx eas-cli update --channel preview --environment preview --message "descripcion del cambio"
```

Llegan a los APK con la misma versión de la app (`runtimeVersion` según la versión); abre la app dos veces para que se apliquen. Los cambios en el módulo Kotlin sí requieren un APK nuevo.

## Pruebas

*   `packages/core`: pruebas unitarias del intérprete de notificaciones (con textos reales de Nu y Nequi, ya enmascarados), matemáticas financieras, cifrado de respaldos, validación de restauraciones, reconocimiento del nombre y limpieza de las respuestas de la IA.
*   `packages/db`: migraciones y restricciones del esquema contra SQLite real.
*   `apps/mobile/src/services/flows.test.ts`: flujos de dinero de punta a punta (tarjetas, cuotas, abonos, notificaciones, transferencias, cobros, ajustes de deudas, deshacer, remitentes y modo demo) con los servicios reales contra SQLite.
*   El CI de GitHub Actions ejecuta todo esto y el typecheck en cada push.

```bash
npm run test --workspaces --if-present
npm run typecheck --workspaces --if-present
```

## Contribuir

### Agregar el formato de un banco

1.  Copia el texto de la notificación desde **Borradores** (ya viene enmascarado). Nunca publiques una notificación sin enmascarar: nombres, números de cuenta y celulares son datos personales.
2.  Agrega un caso en `packages/core/src/notifications/notifications.test.ts`.
3.  Ajusta `packages/core/src/notifications/parse.ts` hasta que el test pase.
4.  Ejecuta `npm run test --workspaces --if-present` y abre un pull request.

## Hoja de ruta

*   Importar notificaciones sin abrir la app (requiere decidir cómo accede a la clave de la base de datos).
*   Verificar los avisos de Nequi al enviar y de Nu al recibir, para completar las transferencias automáticas.
*   Reasignar a una cuenta recién creada los movimientos que quedaron sin cuenta.
*   Reabrir un cobro cuando se borra el ingreso que lo descontó.
*   Ocultar el monto de las confirmaciones en la pantalla bloqueada.
*   Sincronización opcional de cobros y ajustes de deuda.

## Licencia

MIT © 2026 Edison Javier Gonzalez Velosa. Ver [LICENSE](LICENSE).