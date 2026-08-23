begin;

create table if not exists public.moderation_user_states (
  guild_id text not null,
  user_id text not null,
  warnings integer not null default 0 check (warnings >= 0),
  trust smallint not null default 100 check (trust in (0, 50, 100)),
  ai_monitor_until timestamptz,
  warning_history jsonb not null default '[]'::jsonb check (jsonb_typeof(warning_history) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create index if not exists moderation_user_states_monitor_idx
  on public.moderation_user_states (ai_monitor_until) where ai_monitor_until is not null;

create or replace function public.record_moderation_warning(p_guild_id text, p_user_id text, p_warning jsonb)
returns public.moderation_user_states
language plpgsql security definer set search_path = public, pg_temp
as $record_moderation_warning$
declare v_state public.moderation_user_states;
begin
  if nullif(pg_catalog.btrim(p_guild_id), '') is null or nullif(pg_catalog.btrim(p_user_id), '') is null then
    raise exception 'Parametros invalidos' using errcode = '22023';
  end if;
  insert into public.moderation_user_states (guild_id, user_id, warnings, trust, ai_monitor_until, warning_history)
  values (p_guild_id, p_user_id, 1, 100, now() + interval '60 minutes', jsonb_build_array(p_warning))
  on conflict (guild_id, user_id) do update set
    warnings = moderation_user_states.warnings + 1,
    trust = greatest(0, 100 - floor((moderation_user_states.warnings + 1) / 3.0)::integer * 50),
    ai_monitor_until = now() + interval '60 minutes',
    warning_history = moderation_user_states.warning_history || jsonb_build_array(p_warning),
    updated_at = now()
  returning * into v_state;
  return v_state;
end
$record_moderation_warning$;

revoke all on function public.record_moderation_warning(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_moderation_warning(text, text, jsonb) to service_role;

commit;
notify pgrst, 'reload schema';
