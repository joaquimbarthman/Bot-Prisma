begin;

alter table public.prisma_memories
  drop constraint if exists prisma_memories_memory_type_check;

alter table public.prisma_memories
  drop constraint if exists prisma_memories_memory_type_allowed;

alter table public.prisma_memories
  add constraint prisma_memories_memory_type_allowed
  check (memory_type in (
    'preference', 'interest', 'media', 'game', 'hobby', 'project', 'goal',
    'event', 'achievement', 'routine', 'communication', 'social',
    'inside_joke', 'relationship'
  ));

create or replace function public.set_prisma_memory_valid_until()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.valid_until is null then
    new.valid_until := now() + interval '180 days';
  end if;
  if new.last_confirmed_at is null then new.last_confirmed_at := now(); end if;
  return new;
end;
$$;

update public.prisma_memories
set valid_until = coalesce(last_confirmed_at, updated_at, created_at, now()) + interval '180 days'
where valid_until is null;

commit;
notify pgrst, 'reload schema';
