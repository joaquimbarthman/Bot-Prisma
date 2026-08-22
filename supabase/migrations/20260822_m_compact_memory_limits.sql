begin;

create or replace function public.enforce_prisma_memory_limit(p_user_id text, p_limit integer default 300)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_changed integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 300), 300));
begin
  update public.prisma_memories
  set status = 'forgotten', updated_at = now()
  where user_id = p_user_id and status = 'active'
    and valid_until is not null and valid_until <= now();

  with ranked as (
    select id, row_number() over (
      order by importance desc, confidence desc, occurrence_count desc,
        last_confirmed_at desc nulls last, updated_at desc
    ) as position
    from public.prisma_memories
    where user_id = p_user_id and status = 'active'
  )
  update public.prisma_memories m
  set status = 'forgotten', updated_at = now()
  from ranked r
  where m.id = r.id and r.position > v_limit;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function public.enforce_prisma_memory_limit(text, integer) from public, anon, authenticated;
grant execute on function public.enforce_prisma_memory_limit(text, integer) to service_role;

create or replace function public.set_prisma_memory_valid_until()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.valid_until is null then
    new.valid_until := now() + case
      when new.memory_type = 'event' then interval '30 days'
      when new.memory_type in ('project', 'goal') then interval '180 days'
      when new.memory_type in ('social', 'relationship', 'achievement', 'routine', 'inside_joke') then interval '365 days'
      when new.memory_type in ('preference', 'interest', 'media', 'game', 'hobby', 'communication') then interval '730 days'
      else interval '365 days'
    end;
  end if;
  if new.last_confirmed_at is null then new.last_confirmed_at := now(); end if;
  return new;
end;
$$;

update public.prisma_memories
set valid_until = coalesce(last_confirmed_at, updated_at, created_at, now()) + interval '365 days'
where memory_type = 'inside_joke'
  and status = 'active'
  and (valid_until is null or valid_until > coalesce(last_confirmed_at, updated_at, created_at, now()) + interval '365 days');

commit;
notify pgrst, 'reload schema';
