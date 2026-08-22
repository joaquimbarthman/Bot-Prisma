begin;

create or replace function public.set_prisma_memory_valid_until()
returns trigger
language plpgsql
set search_path = pg_catalog
as $set_prisma_memory_valid_until$
begin
  if new.valid_until is null then
    new.valid_until := now() + case
      when new.memory_type = 'event' then interval '30 days'
      when new.memory_type = 'project' then interval '180 days'
      when new.memory_type in ('social', 'relationship') then interval '365 days'
      when new.memory_type in ('preference', 'interest', 'communication', 'inside_joke') then interval '730 days'
      else interval '365 days'
    end;
  end if;
  return new;
end
$set_prisma_memory_valid_until$;

drop trigger if exists prisma_memories_default_validity on public.prisma_memories;
create trigger prisma_memories_default_validity
before insert or update of memory_type on public.prisma_memories
for each row execute function public.set_prisma_memory_valid_until();

update public.prisma_memories
set valid_until = now() + case
  when memory_type = 'event' then interval '30 days'
  when memory_type = 'project' then interval '180 days'
  when memory_type in ('social', 'relationship') then interval '365 days'
  when memory_type in ('preference', 'interest', 'communication', 'inside_joke') then interval '730 days'
  else interval '365 days'
end
where status = 'active' and valid_until is null;

revoke all on function public.set_prisma_memory_valid_until() from public, anon, authenticated;
grant execute on function public.set_prisma_memory_valid_until() to service_role;

commit;

notify pgrst, 'reload schema';
