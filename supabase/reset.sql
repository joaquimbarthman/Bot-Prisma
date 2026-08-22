-- ATENÇÃO: este script apaga permanentemente todas as tabelas e dados do projeto.
-- Execute-o no SQL Editor do Supabase somente quando quiser recriar o banco.

begin;

drop function if exists public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
);
drop function if exists public.reset_prisma_state(text, boolean);
drop function if exists public.delete_prisma_user_data(text, text);

drop table if exists public.gallery_posts cascade;
drop table if exists public.lfg_sessions cascade;
drop table if exists public.prisma_daily_summaries cascade;
drop table if exists public.prisma_messages cascade;
drop table if exists public.prisma_memories cascade;
drop table if exists public.prisma_user_profiles cascade;
drop table if exists public.prisma_emotional_states cascade;
drop table if exists public.ai_events cascade;
drop table if exists public.ai_usage cascade;
drop table if exists public.conversation_history cascade;
drop table if exists public.prisma_temperament cascade;
drop table if exists public.prisma_relationships cascade;
drop table if exists public.prisma_operator_rules cascade;
drop table if exists public.user_settings cascade;

commit;

notify pgrst, 'reload schema';
