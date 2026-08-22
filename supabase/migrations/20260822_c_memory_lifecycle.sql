begin;

alter table public.prisma_memories
  add column if not exists status text not null default 'active',
  add column if not exists superseded_by bigint references public.prisma_memories(id) on delete set null,
  add column if not exists valid_until timestamptz,
  add column if not exists last_confirmed_at timestamptz not null default now();

alter table public.prisma_memories drop constraint if exists prisma_memories_status_check;
alter table public.prisma_memories
  add constraint prisma_memories_status_check
  check (status in ('active','superseded','forgotten'));

update public.prisma_memories
set last_confirmed_at = coalesce(last_seen_at, updated_at, created_at, now())
where last_confirmed_at is null;

drop index if exists public.prisma_memories_user_content_uidx;
drop index if exists public.prisma_memories_user_key_uidx;
drop index if exists public.prisma_memories_active_user_content_uidx;
drop index if exists public.prisma_memories_active_user_key_uidx;

create unique index prisma_memories_active_user_content_uidx
  on public.prisma_memories (user_id, lower(content))
  where status = 'active';
create unique index prisma_memories_active_user_key_uidx
  on public.prisma_memories (user_id, memory_key)
  where memory_key is not null and status = 'active';
create index if not exists prisma_memories_user_status_idx
  on public.prisma_memories (user_id, status, updated_at desc);

commit;

notify pgrst, 'reload schema';
