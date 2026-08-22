begin;

-- Um vínculo novo não recebe proximidade antes de ela ser construída.
-- Registros existentes não são alterados; o reset recria a relação em zero.
alter table public.prisma_relationships
  alter column familiarity set default 0,
  alter column warmth set default 0,
  alter column patience set default 0,
  alter column banter set default 0,
  alter column trust set default 0;

commit;
