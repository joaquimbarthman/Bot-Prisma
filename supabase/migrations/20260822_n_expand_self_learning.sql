begin;

alter table public.prisma_self_learnings
  drop constraint if exists prisma_self_learnings_category_check;

alter table public.prisma_self_learnings
  drop constraint if exists prisma_self_learnings_category_allowed;

alter table public.prisma_self_learnings
  add constraint prisma_self_learnings_category_allowed
  check (category in (
    'conversation_style', 'language_pattern', 'tone_strategy',
    'interaction_pattern', 'response_strategy', 'recurring_topic',
    'topic_affinity', 'self_correction'
  ));

commit;
notify pgrst, 'reload schema';
