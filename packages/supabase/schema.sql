-- ============================================================================
--  FinZen · esquema de Supabase (plan gratuito)
--  Pégalo completo en: Supabase → SQL Editor → New query → Run.
--  Es idempotente: puedes ejecutarlo más de una vez.
--
--  Seguridad:
--   - Cada fila lleva user_id = auth.uid() y Row Level Security hace que cada usuario
--     solo pueda ver/crear/modificar/borrar SUS filas.
--   - "Última escritura gana": un trigger descarta cualquier UPDATE cuyo updated_at sea
--     más viejo que el que ya está guardado (resuelve conflictos entre dispositivos).
--   - NUNCA uses la clave service_role en la app. Solo la anon key (pública por diseño;
--     es RLS lo que protege los datos).
-- ============================================================================

-- Trigger común de "última escritura gana"
create or replace function public.finzen_keep_newer() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null;            -- descarta el cambio viejo
  end if;
  return new;
end $$;

-- ───────────────────────── Tablas ─────────────────────────
create table if not exists public.accounts (
  id text primary key, user_id uuid not null default auth.uid(),
  name text not null, kind text not null, balance bigint not null default 0, currency text not null default 'COP',
  last4 text, archived integer not null default 0,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.categories (
  id text primary key, user_id uuid not null default auth.uid(),
  name text not null, parent_id text, kind text not null default 'expense', icon text, is_system integer not null default 0,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.debts (
  id text primary key, user_id uuid not null default auth.uid(),
  name text not null, kind text not null, provider text,
  principal bigint not null, balance bigint not null,
  installments_total integer, monthly_payment bigint, monthly_rate double precision not null default 0,
  fixed_fee_per_installment bigint not null default 0,
  due_day integer, first_due_date text, status text not null default 'active', origin_transaction_id text,
  credit_limit bigint, cut_day integer, parent_debt_id text,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.debt_installments (
  id text primary key, user_id uuid not null default auth.uid(),
  debt_id text not null, number integer not null, due_date text not null,
  principal bigint not null, interest bigint not null, fee bigint not null default 0, total bigint not null,
  paid_at bigint,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.transactions (
  id text primary key, user_id uuid not null default auth.uid(),
  account_id text, category_id text, debt_id text,
  type text not null, amount bigint not null, merchant text, note text,
  occurred_at bigint not null, source text not null default 'manual',
  payment_method text not null default 'unknown', status text not null default 'posted', dedupe_hash text,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.budgets (
  id text primary key, user_id uuid not null default auth.uid(),
  category_id text not null, month text, amount bigint not null, alert_threshold double precision not null default 0.8,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

create table if not exists public.categorization_rules (
  id text primary key, user_id uuid not null default auth.uid(),
  pattern text not null, match_type text not null default 'contains', category_id text not null, priority integer not null default 0,
  created_at bigint not null, updated_at bigint not null, deleted_at bigint
);

-- Preferencias compartidas entre dispositivos (paleta y modo)
create table if not exists public.app_settings (
  user_id uuid not null default auth.uid(), key text not null, value text not null, updated_at bigint not null,
  primary key (user_id, key)
);

-- ───────────────────────── Índices para la descarga incremental ─────────────────────────
create index if not exists accounts_sync on public.accounts (user_id, updated_at);
create index if not exists categories_sync on public.categories (user_id, updated_at);
create index if not exists debts_sync on public.debts (user_id, updated_at);
create index if not exists debt_installments_sync on public.debt_installments (user_id, updated_at);
create index if not exists transactions_sync on public.transactions (user_id, updated_at);
create index if not exists budgets_sync on public.budgets (user_id, updated_at);
create index if not exists categorization_rules_sync on public.categorization_rules (user_id, updated_at);

-- ───────────────────────── Triggers y RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','debts','debt_installments','transactions','budgets','categorization_rules']
  loop
    execute format('drop trigger if exists keep_newer on public.%I', t);
    execute format('create trigger keep_newer before update on public.%I for each row execute function public.finzen_keep_newer()', t);

    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.app_settings enable row level security;
drop policy if exists own_rows on public.app_settings;
create policy own_rows on public.app_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Nadie sin sesión toca nada
revoke all on all tables in schema public from anon;

-- ───────────────────────── Borrar mis datos de la nube ─────────────────────────
-- La app lo llama desde Ajustes → Eliminar datos. (Para borrar también tu usuario:
-- Supabase → Authentication → Users → Delete user.)
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.transactions where user_id = auth.uid();
  delete from public.debt_installments where user_id = auth.uid();
  delete from public.debts where user_id = auth.uid();
  delete from public.budgets where user_id = auth.uid();
  delete from public.categorization_rules where user_id = auth.uid();
  delete from public.accounts where user_id = auth.uid();
  delete from public.categories where user_id = auth.uid();
  delete from public.app_settings where user_id = auth.uid();
end $$;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
