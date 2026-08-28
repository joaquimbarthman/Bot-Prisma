begin;

create or replace function public.enforce_prisma_memory_limit(p_user_id text, p_limit integer default 99)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_changed integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 99), 99));
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

with ranked as (
  select id, row_number() over (
    partition by user_id
    order by importance desc, confidence desc, occurrence_count desc,
      last_confirmed_at desc nulls last, updated_at desc
  ) as position
  from public.prisma_memories
  where status = 'active'
)
update public.prisma_memories m
set status = 'forgotten', updated_at = now()
from ranked r
where m.id = r.id and r.position > 99;

commit;
notify pgrst, 'reload schema';
