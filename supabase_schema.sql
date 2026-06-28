-- ══════════════════════════════════════
-- NightGames — Supabase Schema
-- Copiez-collez ce SQL dans :
-- Supabase Dashboard → SQL Editor → New query
-- ══════════════════════════════════════

-- 1. TABLE: rooms
create table if not exists rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  host_id     uuid not null,
  status      text not null default 'waiting',  -- waiting | playing | finished
  game        text,
  game_state  jsonb,
  created_at  timestamptz default now()
);

-- 2. TABLE: players
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  name        text not null,
  avatar      text not null default '🐼',
  score       int not null default 0,
  role        text,
  is_host     boolean not null default false,
  joined_at   timestamptz default now()
);

-- 3. INDEXES for performance
create index if not exists idx_rooms_code     on rooms(code);
create index if not exists idx_players_room   on players(room_id);

-- 4. REALTIME — enable replication on both tables
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;

-- 5. ROW LEVEL SECURITY — allow all for anon (simple, no auth needed)
alter table rooms   enable row level security;
alter table players enable row level security;

create policy "Public rooms"   on rooms   for all using (true) with check (true);
create policy "Public players" on players for all using (true) with check (true);

-- 6. AUTO CLEANUP — rooms older than 6 hours (optional cron via pg_cron)
-- Si vous activez pg_cron dans Supabase (plan payant) :
-- select cron.schedule('cleanup-rooms', '0 * * * *',
--   $$delete from rooms where created_at < now() - interval '6 hours'$$);

-- ══════════════════════════════════════
-- ✅ Schéma prêt !
-- ══════════════════════════════════════
