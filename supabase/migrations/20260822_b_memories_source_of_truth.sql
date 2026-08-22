begin;

-- Converte a preferência relacional aprendida em uma memória de comunicação.
insert into public.prisma_memories (
  user_id, memory_key, memory_type, content, importance, confidence,
  occurrence_count, last_seen_at, created_at, updated_at
)
select discord_id, 'communication-style:inferred', 'communication',
  'Prefere respostas ' || trim(preferred_style) || '.', 62, 65, 1,
  coalesce(updated_at, now()), coalesce(created_at, now()), coalesce(updated_at, now())
from public.prisma_relationships
where nullif(trim(preferred_style), '') is not null
on conflict (user_id, memory_key) where memory_key is not null do update set
  content = excluded.content,
  importance = greatest(public.prisma_memories.importance, excluded.importance),
  confidence = greatest(public.prisma_memories.confidence, excluded.confidence),
  last_seen_at = greatest(public.prisma_memories.last_seen_at, excluded.last_seen_at),
  updated_at = greatest(public.prisma_memories.updated_at, excluded.updated_at);

drop function if exists public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
);

alter table public.prisma_relationships drop column preferred_style;

create or replace function public.apply_prisma_state(
  p_discord_id text,
  p_familiarity smallint,
  p_warmth smallint,
  p_patience smallint,
  p_banter smallint,
  p_trust smallint,
  p_relationship_summary text,
  p_recent_milestones jsonb,
  p_interaction_count integer,
  p_summary_updated_at timestamptz,
  p_relationship_created_at timestamptz,
  p_relationship_updated_at timestamptz,
  p_mood text,
  p_energy smallint,
  p_sarcasm smallint,
  p_affection smallint,
  p_last_interaction_at timestamptz,
  p_temperament_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $apply_prisma_state$
declare
  v_discord_id text := nullif(pg_catalog.btrim(p_discord_id), '');
begin
  if v_discord_id is null then
    raise exception 'p_discord_id nao pode ser vazio' using errcode = '22023';
  end if;

  insert into public.prisma_relationships (
    discord_id, familiarity, warmth, patience, banter, trust,
    relationship_summary, recent_milestones, interaction_count,
    summary_updated_at, created_at, updated_at
  ) values (
    v_discord_id, p_familiarity, p_warmth, p_patience, p_banter, p_trust,
    p_relationship_summary, p_recent_milestones, p_interaction_count,
    p_summary_updated_at, p_relationship_created_at, p_relationship_updated_at
  )
  on conflict (discord_id) do update set
    familiarity = excluded.familiarity,
    warmth = excluded.warmth,
    patience = excluded.patience,
    banter = excluded.banter,
    trust = excluded.trust,
    relationship_summary = excluded.relationship_summary,
    recent_milestones = excluded.recent_milestones,
    interaction_count = excluded.interaction_count,
    summary_updated_at = excluded.summary_updated_at,
    updated_at = excluded.updated_at;

  insert into public.prisma_emotional_states (
    user_id, mood, energy, sarcasm, affection, last_interaction_at, updated_at
  ) values (
    v_discord_id, p_mood, p_energy, p_sarcasm, p_affection,
    p_last_interaction_at, p_temperament_updated_at
  )
  on conflict (user_id) do update set
    mood = excluded.mood,
    energy = excluded.energy,
    sarcasm = excluded.sarcasm,
    affection = excluded.affection,
    last_interaction_at = excluded.last_interaction_at,
    updated_at = excluded.updated_at;
end
$apply_prisma_state$;

revoke all on function public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_prisma_state(
  text, smallint, smallint, smallint, smallint, smallint, text, jsonb,
  integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint,
  smallint, timestamptz, timestamptz
) to service_role;

commit;

notify pgrst, 'reload schema';
