begin;

alter table public.leveling_settings
  add column if not exists prisma_reply_bonus integer not null default 1
  check (prisma_reply_bonus >= 0);

update public.leveling_settings
set prisma_reply_bonus = 1
where prisma_reply_bonus is null;

commit;
