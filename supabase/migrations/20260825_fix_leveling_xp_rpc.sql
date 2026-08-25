begin;

create or replace function public.award_level_xp(
  p_guild_id text,
  p_user_id text,
  p_amount integer,
  p_source text,
  p_max_level integer default 100
)
returns table (
  guild_id text,
  user_id text,
  xp_total bigint,
  level integer,
  last_chat_xp_at timestamptz,
  last_voice_xp_at timestamptz,
  current_reward_role_id text,
  created_at timestamptz,
  updated_at timestamptz,
  previous_level integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $award_level_xp$
declare
  v_previous integer;
  v_level integer := 0;
  v_xp bigint;
  v_required bigint := 0;
  v_current integer;
begin
  if nullif(btrim(p_guild_id), '') is null
    or nullif(btrim(p_user_id), '') is null
    or p_amount < 0
    or p_source not in ('chat', 'voice')
    or p_max_level not between 1 and 100
  then
    raise exception 'Parametros de XP invalidos' using errcode = '22023';
  end if;

  insert into public.member_levels as m (
    guild_id,
    user_id,
    xp_total,
    last_chat_xp_at,
    last_voice_xp_at
  )
  values (
    p_guild_id,
    p_user_id,
    p_amount,
    case when p_source = 'chat' then now() end,
    case when p_source = 'voice' then now() end
  )
  on conflict on constraint member_levels_pkey do update set
    xp_total = m.xp_total + excluded.xp_total,
    last_chat_xp_at = case when p_source = 'chat' then now() else m.last_chat_xp_at end,
    last_voice_xp_at = case when p_source = 'voice' then now() else m.last_voice_xp_at end,
    updated_at = now()
  returning m.level, m.xp_total into v_previous, v_xp;

  for v_current in 1..p_max_level loop
    v_required := v_required + round(32 + 5 * (v_current - 1) + 0.5 * (v_current - 1) * (v_current - 1));
    if v_xp >= v_required then v_level := v_current; else exit; end if;
  end loop;

  update public.member_levels as m
  set level = v_level, updated_at = now()
  where m.guild_id = p_guild_id and m.user_id = p_user_id;

  return query
  select m.guild_id, m.user_id, m.xp_total, m.level, m.last_chat_xp_at,
    m.last_voice_xp_at, m.current_reward_role_id, m.created_at, m.updated_at,
    v_previous
  from public.member_levels as m
  where m.guild_id = p_guild_id and m.user_id = p_user_id;
end
$award_level_xp$;

revoke all on function public.award_level_xp(text, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.award_level_xp(text, text, integer, text, integer)
  to service_role;

commit;
notify pgrst, 'reload schema';
