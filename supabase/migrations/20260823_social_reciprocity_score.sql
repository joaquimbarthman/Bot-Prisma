begin;

alter table public.prisma_relationships
  add column if not exists attitude_score smallint not null default 0;

alter table public.prisma_relationships
  drop constraint if exists prisma_relationships_attitude_score_check;

alter table public.prisma_relationships
  add constraint prisma_relationships_attitude_score_check
  check (attitude_score between -5 and 10);

commit;
notify pgrst, 'reload schema';
