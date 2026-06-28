-- ============================================================
-- FASTRO — Suscripciones de notificaciones push (Web Push)
-- Una fila por dispositivo/navegador suscripto. La Edge Function `send-push`
-- las lee con service role para enviar; cada usuario administra (alta/baja)
-- solo las suyas desde la app.
--
-- Correr en el SQL Editor del proyecto FASTRO (ref rsnhzmjqyiswdkfzizsm).
-- ============================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada usuario solo ve/gestiona sus propias suscripciones.
-- (La función usa la service role key, que ignora RLS.)
drop policy if exists "own_select" on public.push_subscriptions;
create policy "own_select" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "own_insert" on public.push_subscriptions;
create policy "own_insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_update" on public.push_subscriptions;
create policy "own_update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_delete" on public.push_subscriptions;
create policy "own_delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
