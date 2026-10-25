/**
 * Migración 001 — esquema inicial de FinZen.
 *
 * Decisiones de diseño:
 *  - Las migraciones son strings TS (no archivos .sql) para que las pueda importar
 *    tanto Metro (Expo) como Vite (Tauri) sin plugins especiales.
 *  - IDs = TEXT (UUID generado en el cliente): permite crear filas offline sin colisiones
 *    y sincronizar con Supabase sin remapear claves.
 *  - Dinero = INTEGER en pesos enteros (COP no usa centavos en la práctica). Evita los
 *    errores de coma flotante. Las tasas sí son REAL (son proporciones, no dinero).
 *  - Fechas = INTEGER epoch en milisegundos (UTC), salvo `due_date` que es 'YYYY-MM-DD'
 *    porque un vencimiento es un día calendario, no un instante.
 *  - Columnas de sync en tablas de usuario: updated_at (para "última escritura gana")
 *    y deleted_at (borrado lógico, así el borrado también se sincroniza).
 *  - notifications_log, notification_sources y device_settings son SOLO LOCALES:
 *    nunca se suben a la nube.
 */
export const MIGRATION_001_INIT = /* sql */ `
-- ───────────────────────── Cuentas (activos) ─────────────────────────
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('savings','checking','cash','wallet','investment')),
  balance     INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'COP',
  last4       TEXT CHECK (last4 IS NULL OR length(last4) <= 4), -- solo últimos 4 dígitos, jamás el número completo
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- ───────────────────────── Categorías ─────────────────────────
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id),     -- subcategoría (p. ej. Comida > Domicilio)
  kind        TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income')),
  icon        TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,          -- las predefinidas no se borran
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- ───────────────────────── Deudas ─────────────────────────
-- Cubre tarjetas, préstamos, deudas informales y compras a cuotas (Addi, Sistecrédito, etc.)
CREATE TABLE debts (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('credit_card','loan','bnpl','informal')),
  provider              TEXT,                         -- 'addi','sistecredito','nu',...
  principal             INTEGER NOT NULL,             -- monto financiado original
  balance               INTEGER NOT NULL,             -- saldo de capital pendiente
  installments_total    INTEGER,                      -- n.º de cuotas (NULL en tarjetas rotativas)
  monthly_payment       INTEGER,                      -- cuota mensual (capital + interés + cargos)
  monthly_rate          REAL NOT NULL DEFAULT 0,      -- tasa mensual como proporción (0.02 = 2 %)
  fixed_fee_per_installment INTEGER NOT NULL DEFAULT 0, -- cargo fijo por cuota (seguro, aval, manejo)
  due_day               INTEGER CHECK (due_day BETWEEN 1 AND 31),
  first_due_date        TEXT,                         -- 'YYYY-MM-DD'
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid')),
  origin_transaction_id TEXT,                         -- compra que originó la deuda (si vino de una notificación)
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER
);

-- Calendario de cuotas de cada deuda (tabla de amortización)
CREATE TABLE debt_installments (
  id          TEXT PRIMARY KEY,
  debt_id     TEXT NOT NULL REFERENCES debts(id),
  number      INTEGER NOT NULL,                       -- 1..n
  due_date    TEXT NOT NULL,                          -- 'YYYY-MM-DD'
  principal   INTEGER NOT NULL,
  interest    INTEGER NOT NULL,
  fee         INTEGER NOT NULL DEFAULT 0,
  total       INTEGER NOT NULL,                       -- principal + interest + fee
  paid_at     INTEGER,                                -- NULL = pendiente
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  UNIQUE (debt_id, number)
);
CREATE INDEX idx_installments_due ON debt_installments(due_date) WHERE paid_at IS NULL AND deleted_at IS NULL;

-- ───────────────────────── Transacciones ─────────────────────────
CREATE TABLE transactions (
  id             TEXT PRIMARY KEY,
  account_id     TEXT REFERENCES accounts(id),
  category_id    TEXT REFERENCES categories(id),
  debt_id        TEXT REFERENCES debts(id),           -- si la compra fue a crédito/cuotas
  type           TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
  amount         INTEGER NOT NULL CHECK (amount > 0), -- siempre positivo; el signo lo da "type"
  merchant       TEXT,
  note           TEXT,
  occurred_at    INTEGER NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','notification','ocr','csv','voice')),
  payment_method TEXT NOT NULL DEFAULT 'unknown' CHECK (payment_method IN ('cash','debit','credit','bnpl','unknown')),
  -- 'needs_installments': llegó por notificación de crédito y falta preguntar cuántas cuotas
  -- 'needs_review': categoría o datos dudosos
  status         TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','needs_review','needs_installments')),
  dedupe_hash    TEXT UNIQUE,                         -- evita registrar dos veces la misma notificación
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER
);
CREATE INDEX idx_tx_occurred ON transactions(occurred_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_tx_status   ON transactions(status)      WHERE status <> 'posted' AND deleted_at IS NULL;

-- ───────────────────────── Presupuestos ─────────────────────────
CREATE TABLE budgets (
  id               TEXT PRIMARY KEY,
  category_id      TEXT NOT NULL REFERENCES categories(id),
  month            TEXT,                              -- 'YYYY-MM'; NULL = aplica a todos los meses
  amount           INTEGER NOT NULL CHECK (amount >= 0),
  alert_threshold  REAL NOT NULL DEFAULT 0.8,         -- avisar al llegar al 80 %
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  deleted_at       INTEGER,
  UNIQUE (category_id, month)
);

-- ───────────────────────── Reglas de categorización ─────────────────────────
CREATE TABLE categorization_rules (
  id           TEXT PRIMARY KEY,
  pattern      TEXT NOT NULL,                         -- "rappi"
  match_type   TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains','regex')),
  category_id  TEXT NOT NULL REFERENCES categories(id),
  priority     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER
);

-- ───────────────────────── Solo locales (NO se sincronizan) ─────────────────────────
-- Bitácora de notificaciones: guarda únicamente el texto YA enmascarado, nunca el original.
-- Para OTPs y apps fuera de la lista blanca no se guarda texto (masked_text = NULL).
CREATE TABLE notifications_log (
  id              TEXT PRIMARY KEY,
  source_package  TEXT NOT NULL,
  received_at     INTEGER NOT NULL,
  masked_text     TEXT,
  text_hash       TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN
                    ('imported','discarded_otp','discarded_not_whitelisted','discarded_unparsed','duplicate')),
  transaction_id  TEXT REFERENCES transactions(id)
);
CREATE INDEX idx_notiflog_received ON notifications_log(received_at);

-- Lista blanca de apps cuyas notificaciones se leen
CREATE TABLE notification_sources (
  id               TEXT PRIMARY KEY,                  -- 'nequi','addi',...
  label            TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('bank','wallet','bnpl')),
  package_pattern  TEXT NOT NULL,                     -- regex sobre el packageName de Android
  enabled          INTEGER NOT NULL DEFAULT 1,
  user_added       INTEGER NOT NULL DEFAULT 0
);

-- Cola de cambios pendientes de subir a Supabase
CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload     TEXT,                                   -- JSON de la fila
  created_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT
);
CREATE INDEX idx_sync_queue_table_row ON sync_queue(table_name, row_id);

-- Ajustes. scope='user' se sincroniza (paleta, modo); scope='device' nunca (PIN, biometría, URL de Ollama).
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user','device')),
  updated_at  INTEGER NOT NULL
);
`;
