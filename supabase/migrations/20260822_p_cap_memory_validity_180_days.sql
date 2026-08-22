begin;

create or replace function public.set_prisma_memory_valid_until()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.valid_until is null then new.valid_until := now() + interval '180 days'; end if;

  -- Todos os tipos de memória vencem em no máximo 180 dias.
  new.valid_until := least(new.valid_until, now() + interval '180 days');
  if new.last_confirmed_at is null then new.last_confirmed_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists prisma_memories_default_validity on public.prisma_memories;
create trigger prisma_memories_default_validity
before insert or update of memory_type, valid_until, last_confirmed_at on public.prisma_memories
for each row execute function public.set_prisma_memory_valid_until();

update public.prisma_memories
set valid_until = least(
  valid_until,
  coalesce(last_confirmed_at, updated_at, created_at, now()) + interval '180 days'
)
where status = 'active'
  and valid_until > coalesce(last_confirmed_at, updated_at, created_at, now()) + interval '180 days';

revoke all on function public.set_prisma_memory_valid_until() from public, anon, authenticated;
grant execute on function public.set_prisma_memory_valid_until() to service_role;

commit;
notify pgrst, 'reload schema';
