-- ATENÇÃO: este script apaga permanentemente todas as tabelas e dados do projeto.
-- Execute-o no SQL Editor do Supabase somente quando quiser recriar o banco.

begin;

drop function if exists public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
);
drop function if exists public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
);
drop function if exists public.reset_prisma_state(text, boolean);
drop function if exists public.delete_prisma_user_data(text, text);
drop function if exists public.set_prisma_memory_valid_until();
drop function if exists public.enforce_prisma_memory_limit(text, integer);
drop function if exists public.save_prisma_daily_summary(text, date, text, text[]);
drop function if exists public.enforce_prisma_retention(timestamptz);
drop function if exists public.consolidate_prisma_daily_summaries(date);
drop function if exists public.consolidate_prisma_summaries(date, date);

drop table if exists public.gallery_posts cascade;
drop table if exists public.lfg_sessions cascade;
drop table if exists public.prisma_daily_summaries cascade;
drop table if exists public.prisma_weekly_summaries cascade;
drop table if exists public.prisma_period_summaries cascade;
drop table if exists public.prisma_messages cascade;
drop table if exists public.prisma_memories cascade;
drop table if exists public.prisma_user_profiles cascade;
drop table if exists public.prisma_emotional_states cascade;
drop table if exists public.ai_events cascade;
drop table if exists public.ai_usage cascade;
drop table if exists public.conversation_history cascade;
-- Compatibilidade com bancos anteriores à unificação do estado por pessoa.
drop table if exists public.prisma_temperament cascade;
drop table if exists public.prisma_relationships cascade;
drop table if exists public.prisma_operator_rules cascade;
drop table if exists public.prisma_self_learnings cascade;
drop table if exists public.user_settings cascade;

commit;

notify pgrst, 'reload schema';
