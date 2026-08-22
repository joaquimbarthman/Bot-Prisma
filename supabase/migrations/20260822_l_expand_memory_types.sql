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
set valid_until = coalesce(last_confirmed_at, updated_at, created_at, now()) + case
  when memory_type = 'event' then interval '30 days'
  when memory_type in ('project', 'goal') then interval '180 days'
  when memory_type in ('social', 'relationship', 'achievement', 'routine', 'inside_joke') then interval '365 days'
  when memory_type in ('preference', 'interest', 'media', 'game', 'hobby', 'communication') then interval '730 days'
  else interval '365 days'
end
where valid_until is null;

commit;
notify pgrst, 'reload schema';
