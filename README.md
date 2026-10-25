# FinZen - Gestor de Finanzas Personales Offline-First

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Expo](https://img.shields.io/badge/Expo-1B1B1B?style=for-the-badge&logo=expo&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

FinZen es una aplicación móvil de finanzas personales diseñada bajo el paradigma **Offline-First** (funciona sin conexión a internet). Su objetivo es ofrecer un control absoluto, privado y seguro sobre el dinero, eliminando la dependencia de servidores externos y evitando el envío de datos sensibles a la nube.

## Características

*   **Seguridad Avanzada:** Base de datos local cifrada con SQLCipher (AES-256). Sistema de bloqueo por PIN/Biometría y bloqueo de capturas de pantalla.
*   **Lectura de Notificaciones:** Módulo nativo en Kotlin (Android) que intercepta notificaciones de apps bancarias (Nequi, Nu, Bancolombia, etc.), descarta OTPs, enmascara números de tarjeta y autocompleta las transacciones.
*   **Procesamiento de Datos:** Si una notificación no coincide con los patrones esperados, se envía a una bandeja de "Borradores" para revisión manual, evitando la pérdida de información.
*   **Gestión Financiera:** Cálculo matemático determinista (método francés) para tarjetas de crédito, compras a cuotas (Addi, Sistecrédito) y préstamos. Incluye simulador de abono extra y método avalancha.
*   **Dashboard y Presupuestos:** Visualización de patrimonio neto, gastos por categoría, proyección de gastos fijos y control de presupuestos mensuales.
*   **Edición Transaccional:** Capacidad de editar movimientos pasados, recalculando automáticamente el saldo de las cuentas involucradas (reversión del estado anterior y aplicación del nuevo).
*   **Asistente IA:** Integración opcional con Ollama (local) o Gemini. Envía únicamente datos anonimizados (sin nombres de bancos, comercios ni fechas exactas).
*   **Portabilidad:** Exportación e importación de datos mediante respaldos cifrados en JSON y exportación a CSV (con protección anti-inyección de fórmulas).

## Arquitectura del Proyecto

El proyecto está construido como un Monorepo utilizando NPM Workspaces, separando la lógica de negocio, la base de datos y la interfaz de usuario:

*   `packages/core`: Lógica pura en TypeScript. Contiene los parsers (notificaciones, voz, OCR), las matemáticas financieras (cuotas, tasas) y la criptografía. No tiene dependencias de React Native.
*   `packages/db`: Definición del esquema SQLite, migraciones versionadas y semillas de datos.
*   `packages/supabase`: Esquema SQL opcional para sincronización en la nube (con políticas RLS).
*   `apps/mobile`: Aplicación Expo/React Native. Incluye el módulo nativo Kotlin (`finzen-notifications`) para interceptar notificaciones del sistema.

## Seguridad y Privacidad

La seguridad es un pilar fundamental en la arquitectura de FinZen:

1.  **Local-first:** Los datos nunca salen del dispositivo a menos que el usuario lo autorice explícitamente.
2.  **Cifrado en reposo:** La base de datos SQLite está cifrada usando SQLCipher. La clave se almacena en el Keystore de Android.
3.  **Cifrado de respaldos:** Los archivos de backup se cifran con AES-256-GCM y derivación de claves mediante scrypt.
4.  **Nota sobre Supabase:** La sincronización en la nube es opcional. Los datos viajan mediante HTTPS. Sin embargo, Supabase no implementa cifrado E2EE (End-to-End Encryption). Si se busca privacidad absoluta, se recomienda utilizar exclusivamente los respaldos locales cifrados y mantener desactivada la nube.

## Instalación y Desarrollo

### Prerrequisitos
*   Node.js (v18+)
*   Cuenta en [Expo](https://expo.dev)
*   Android Studio (necesario para compilar el módulo nativo de notificaciones)

### Pasos para correr en local

1.  Clonar el repositorio:
    ```bash
    git clone https://github.com/Terminator2424/Finzen.git
    cd Finzen