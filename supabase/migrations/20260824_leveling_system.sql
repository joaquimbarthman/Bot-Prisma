begin;

create table if not exists public.leveling_settings (
  guild_id text primary key,
  global_multiplier numeric not null default 1 check (global_multiplier >= 0),
  chat_multiplier numeric not null default 1 check (chat_multiplier >= 0),
  voice_multiplier numeric not null default 1 check (voice_multiplier >= 0),
  booster_role_id text default '1538022012591538176',
  booster_multiplier numeric not null default 2 check (booster_multiplier >= 0),
  chat_cooldown_seconds integer not null default 30 check (chat_cooldown_seconds > 0),
  voice_cooldown_seconds integer not null default 300 check (voice_cooldown_seconds > 0),
  announcement_channel_id text not null default '1541550093679730769',
  max_level integer not null default 100 check (max_level between 1 and 100),
  enabled boolean not null default true
);

create table if not exists public.member_levels (
  guild_id text not null,
  user_id text not null,
  xp_total bigint not null default 0 check (xp_total >= 0),
  level integer not null default 0 check (level between 0 and 100),
  last_chat_xp_at timestamptz,
  last_voice_xp_at timestamptz,
  current_reward_role_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create index if not exists member_levels_leaderboard_idx on public.member_levels (guild_id, xp_total desc);

create table if not exists public.level_rewards (
  guild_id text not null,
  level integer not null check (level between 1 and 100),
  role_id text not null,
  emoji text not null default '✦',
  title text not null default 'Novo marco conquistado',
  short_message text not null default 'Marco conquistado' check (char_length(short_message) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, level)
);

create table if not exists public.level_blacklist (
  guild_id text not null,
  type text not null check (type in ('chat', 'voice')),
  target_type text not null check (target_type in ('channel', 'role')),
  target_id text not null,
  primary key (guild_id, type, target_type, target_id)
);

create or replace function public.award_level_xp(p_guild_id text, p_user_id text, p_amount integer, p_source text, p_max_level integer default 100)
returns table (guild_id text, user_id text, xp_total bigint, level integer, last_chat_xp_at timestamptz, last_voice_xp_at timestamptz, current_reward_role_id text, created_at timestamptz, updated_at timestamptz, previous_level integer)
language plpgsql security definer set search_path = pg_catalog
as $award_level_xp$
declare v_previous integer; v_level integer := 0; v_xp bigint; v_required bigint := 0; v_current integer;
begin
  if nullif(btrim(p_guild_id), '') is null or nullif(btrim(p_user_id), '') is null or p_amount < 0 or p_source not in ('chat', 'voice') or p_max_level not between 1 and 100 then raise exception 'Parametros de XP invalidos' using errcode = '22023'; end if;
  insert into public.member_levels as m (guild_id, user_id, xp_total, last_chat_xp_at, last_voice_xp_at)
  values (p_guild_id, p_user_id, p_amount, case when p_source = 'chat' then now() end, case when p_source = 'voice' then now() end)
  on conflict on constraint member_levels_pkey do update set xp_total = m.xp_total + excluded.xp_total, last_chat_xp_at = case when p_source = 'chat' then now() else m.last_chat_xp_at end, last_voice_xp_at = case when p_source = 'voice' then now() else m.last_voice_xp_at end, updated_at = now()
  returning m.level, m.xp_total into v_previous, v_xp;
  for v_current in 1..p_max_level loop v_required := v_required + round(32 + 5 * (v_current - 1) + 0.5 * (v_current - 1) * (v_current - 1)); if v_xp >= v_required then v_level := v_current; else exit; end if; end loop;
  update public.member_levels as m set level = v_level, updated_at = now() where m.guild_id = p_guild_id and m.user_id = p_user_id;
  return query select m.guild_id, m.user_id, m.xp_total, m.level, m.last_chat_xp_at, m.last_voice_xp_at, m.current_reward_role_id, m.created_at, m.updated_at, v_previous from public.member_levels m where m.guild_id = p_guild_id and m.user_id = p_user_id;
end
$award_level_xp$;

revoke all on table public.leveling_settings, public.member_levels, public.level_rewards, public.level_blacklist from public, anon, authenticated;
revoke all on function public.award_level_xp(text, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.award_level_xp(text, text, integer, text, integer) to service_role;
commit;
notify pgrst, 'reload schema';
