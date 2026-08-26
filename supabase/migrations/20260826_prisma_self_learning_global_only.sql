begin;

-- Autoaprendizados descrevem exclusivamente como a Prisma conversa e age.
-- As linhas pessoais eram cópias da mesma proposta global e suas evidências já
-- existem na linha global correspondente, portanto podem ser removidas.
delete from public.prisma_self_learnings where scope = 'personal';

drop index if exists public.prisma_self_learnings_personal_key_uidx;
drop index if exists public.prisma_self_learnings_global_key_uidx;

alter table public.prisma_self_learnings
  drop constraint if exists prisma_self_learnings_scope_check;
alter table public.prisma_self_learnings
  drop constraint if exists prisma_self_learnings_global_user_check;

alter table public.prisma_self_learnings drop column if exists scope;
alter table public.prisma_self_learnings drop column if exists user_id;

create unique index if not exists prisma_self_learnings_key_uidx
  on public.prisma_self_learnings (learning_key);

commit;
notify pgrst, 'reload schema';
