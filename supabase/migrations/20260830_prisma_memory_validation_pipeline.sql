-- Alinha prisma_memories ao pipeline SAVE/UPDATE/MERGE/DISCARD da aplicação.
-- A validação semântica continua centralizada no código; esta migration reforça
-- no banco apenas invariantes estruturais que podem ser verificadas com segurança.

update public.prisma_memories
set
  memory_key = nullif(btrim(memory_key), ''),
  occurrence_count = greatest(coalesce(occurrence_count, 1), 1),
  importance = greatest(0, least(coalesce(importance, 50), 100)),
  confidence = greatest(0, least(coalesce(confidence, 60), 100)),
  updated_at = now()
where
  memory_key is distinct from nullif(btrim(memory_key), '')
  or occurrence_count is null or occurrence_count < 1
  or importance is null or importance not between 0 and 100
  or confidence is null or confidence not between 0 and 100;

-- Memórias ativas que o novo pipeline recusaria por falta de conteúdo mínimo ou
-- evidência suficiente são arquivadas, não apagadas, mantendo recuperação possível.
update public.prisma_memories
set status = 'forgotten', updated_at = now()
where status = 'active'
  and (char_length(btrim(content)) < 8 or confidence < 65);

alter table public.prisma_memories
  drop constraint if exists prisma_memories_user_id_not_blank,
  drop constraint if exists prisma_memories_content_not_blank,
  drop constraint if exists prisma_memories_active_minimum_quality;

alter table public.prisma_memories
  add constraint prisma_memories_user_id_not_blank
    check (char_length(btrim(user_id)) > 0),
  add constraint prisma_memories_content_not_blank
    check (char_length(btrim(content)) between 3 and 300),
  add constraint prisma_memories_active_minimum_quality
    check (status <> 'active' or (char_length(btrim(content)) >= 8 and confidence >= 65));

create index if not exists prisma_memories_validation_lookup_idx
  on public.prisma_memories (user_id, status, memory_type, updated_at desc);

comment on table public.prisma_memories is
  'Memórias pessoais validadas antes da persistência pelo pipeline SAVE/UPDATE/MERGE/DISCARD; registros históricos usam os estados superseded e forgotten.';

