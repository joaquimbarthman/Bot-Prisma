begin;

-- Um vínculo recriado começa sem emoções ou intimidade pré-carregadas.
-- Linhas existentes são preservadas; estes padrões valem para novos resets.
alter table public.prisma_emotional_states
  alter column happiness set default 0,
  alter column affection set default 0,
  alter column curiosity set default 0,
  alter column excitement set default 0,
  alter column confidence set default 0,
  alter column energy set default 0,
  alter column sarcasm set default 0;

commit;
