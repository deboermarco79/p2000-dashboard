-- Narrowcasting schema for Supabase. Run in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ───────────────────────── playlist ─────────────────────────
create table if not exists public.playlist (
  id               uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('image', 'video', 'url')),
  url              text not null,
  duration_seconds integer not null default 10 check (duration_seconds > 0),
  order_index      integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists playlist_order_idx on public.playlist (order_index);

-- ───────────────────────── alerts ───────────────────────────
create table if not exists public.alerts (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);

-- Only one alert can be active at a time (hard guarantee)...
create unique index if not exists alerts_single_active_idx
  on public.alerts (is_active) where is_active;

-- ...and activating a new alert automatically replaces the previous one.
create or replace function public.alerts_single_active()
returns trigger language plpgsql as $$
begin
  if new.is_active then
    update public.alerts set is_active = false
    where is_active and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists alerts_single_active_trg on public.alerts;
create trigger alerts_single_active_trg
  before insert or update of is_active on public.alerts
  for each row execute function public.alerts_single_active();

-- ───────────────────────── realtime ─────────────────────────
alter publication supabase_realtime add table public.playlist;
alter publication supabase_realtime add table public.alerts;

-- ───────────────────────── row level security ───────────────
-- The receiver (anon key, no login) may only READ. Writes require a logged-in
-- Supabase Auth user (create users under Authentication → Users).
alter table public.playlist enable row level security;
alter table public.alerts   enable row level security;

drop policy if exists "playlist anon all" on public.playlist;
drop policy if exists "alerts anon all"   on public.alerts;

create policy "playlist read"  on public.playlist for select to anon, authenticated using (true);
create policy "playlist write" on public.playlist for all    to authenticated using (true) with check (true);

create policy "alerts read"    on public.alerts   for select to anon, authenticated using (true);
create policy "alerts write"   on public.alerts   for all    to authenticated using (true) with check (true);

-- ───────────────────────── seed data ────────────────────────
insert into public.playlist (type, url, duration_seconds, order_index, is_active) values
  ('image', '/slides/welkom.svg',  8, 1, true),
  ('image', '/slides/persco.svg', 10, 2, true),
  ('image', '/slides/wijkagent.svg', 8, 3, true),
  ('image', '/slides/112.svg',     8, 4, true);
