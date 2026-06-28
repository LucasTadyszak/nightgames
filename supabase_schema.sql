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
-- 7. CONTENU DES JEUX (questions, réponses, rôles, règles…)
-- Avant, ce contenu était codé en dur dans les fichiers js/games/*.js.
-- Il vit maintenant en base, pour pouvoir l'éditer/l'enrichir sans
-- toucher au code, et pour préparer la sélection de catégories par les
-- joueurs (Une Famille en Or). Lecture publique uniquement (anon) — pas
-- d'écriture depuis l'app, ce contenu se gère depuis le SQL Editor.
-- ══════════════════════════════════════

-- 7.1 Caméléon Urbain
create table if not exists cameleon_roles (
  id    uuid primary key default gen_random_uuid(),
  role  text not null,
  hint  text not null
);
create table if not exists cameleon_questions (
  id    uuid primary key default gen_random_uuid(),
  text  text not null
);

-- 7.2 Vérité ou Défi
create table if not exists verite_cards (
  id    uuid primary key default gen_random_uuid(),
  type  text not null check (type in ('verite','defi')),
  text  text not null
);

-- 7.3 Mission Impossible
create table if not exists mission_list (
  id    uuid primary key default gen_random_uuid(),
  text  text not null
);

-- 7.4 Une Famille en Or
create table if not exists famille_categories (
  id    text primary key,
  name  text not null,
  icon  text not null
);
create table if not exists famille_questions (
  id        uuid primary key default gen_random_uuid(),
  category  text not null references famille_categories(id),
  question  text not null,
  answers   jsonb not null  -- [{ "t": "Réponse", "pts": 32 }, ...] — 5 items, pts somme à 100
);
create index if not exists idx_famille_questions_category on famille_questions(category);

-- 7.5 Game Changer
create table if not exists changer_rules (
  id      uuid primary key default gen_random_uuid(),
  icon    text not null,
  name    text not null,
  rule    text not null,
  action  text not null
);

-- 7.6 Loups Garous
create table if not exists loups_roles (
  id           text primary key,   -- ex: 'Villageois', 'Loup-Garou'...
  icon         text not null,
  color        text not null,
  description  text not null,
  team         text not null check (team in ('village','loups'))
);

-- 7.7 RLS — lecture publique pour tout le monde, écriture pour personne
-- (pas de policy INSERT/UPDATE/DELETE : seul le SQL Editor peut modifier)
alter table cameleon_roles     enable row level security;
alter table cameleon_questions enable row level security;
alter table verite_cards       enable row level security;
alter table mission_list       enable row level security;
alter table famille_categories enable row level security;
alter table famille_questions  enable row level security;
alter table changer_rules      enable row level security;
alter table loups_roles        enable row level security;

create policy "Public read cameleon_roles"     on cameleon_roles     for select using (true);
create policy "Public read cameleon_questions" on cameleon_questions for select using (true);
create policy "Public read verite_cards"       on verite_cards       for select using (true);
create policy "Public read mission_list"       on mission_list       for select using (true);
create policy "Public read famille_categories" on famille_categories for select using (true);
create policy "Public read famille_questions"  on famille_questions  for select using (true);
create policy "Public read changer_rules"      on changer_rules      for select using (true);
create policy "Public read loups_roles"        on loups_roles        for select using (true);

-- ══════════════════════════════════════
-- ✅ Schéma prêt ! Lancez ensuite supabase_seed.sql pour remplir le
-- contenu des jeux (200 questions, rôles, cartes, etc.)
-- ══════════════════════════════════════
