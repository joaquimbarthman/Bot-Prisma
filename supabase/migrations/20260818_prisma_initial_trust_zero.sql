-- Uma relação apagada pelo painel deve recomeçar sem confiança acumulada.
alter table public.prisma_relationships
  alter column trust set default 0;

