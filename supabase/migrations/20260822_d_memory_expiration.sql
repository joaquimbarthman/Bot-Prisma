begin;

create or replace function public.set_prisma_memory_valid_until()
returns trigger
language plpgsql
set search_path = pg_catalog
as $set_prisma_memory_valid_until$
begin
  if new.valid_until is null then
    new.valid_until := now() + interval '180 days';
  end if;
  return new;
end
$set_prisma_memory_valid_until$;

drop trigger if exists prisma_memories_default_validity on public.prisma_memories;
create trigger prisma_memories_default_validity
before insert or update of memory_type on public.prisma_memories
for each row execute function public.set_prisma_memory_valid_until();

update public.prisma_memories
set valid_until = now() + interval '180 days'
where status = 'active' and valid_until is null;

revoke all on function public.set_prisma_memory_valid_until() from public, anon, authenticated;
grant execute on function public.set_prisma_memory_valid_until() to service_role;

commit;

notify pgrst, 'reload schema';
