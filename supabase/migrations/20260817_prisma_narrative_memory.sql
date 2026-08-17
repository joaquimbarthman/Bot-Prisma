begin;

alter table public.prisma_relationships
  add column if not exists recent_milestones jsonb not null default '[]'::jsonb;

update public.prisma_relationships
set recent_milestones = '[]'::jsonb
where recent_milestones is null or jsonb_typeof(recent_milestones) <> 'array';

alter table public.prisma_relationships drop constraint if exists prisma_relationships_recent_milestones_check;
alter table public.prisma_relationships add constraint prisma_relationships_recent_milestones_check
  check (jsonb_typeof(recent_milestones) = 'array' and jsonb_array_length(recent_milestones) <= 5);

drop function if exists public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz);

create or replace function public.apply_prisma_state(
  p_discord_id text,
  p_familiarity smallint,
  p_warmth smallint,
  p_patience smallint,
  p_banter smallint,
  p_trust smallint,
  p_preferred_style text,
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
  v_recent_milestones jsonb := case
    when jsonb_typeof(p_recent_milestones) = 'array' then p_recent_milestones
    else '[]'::jsonb
  end;
begin
  if v_discord_id is null then
    raise exception 'p_discord_id nao pode ser vazio' using errcode = '22023';
  end if;
  if jsonb_array_length(v_recent_milestones) > 5 then
    raise exception 'recent_milestones aceita no maximo cinco itens' using errcode = '22023';
  end if;

  insert into public.prisma_relationships (
    discord_id, familiarity, warmth, patience, banter, trust, preferred_style,
    relationship_summary, recent_milestones, interaction_count, summary_updated_at, created_at, updated_at
  ) values (
    v_discord_id, p_familiarity, p_warmth, p_patience, p_banter, p_trust, p_preferred_style,
    p_relationship_summary, v_recent_milestones, p_interaction_count, p_summary_updated_at,
    p_relationship_created_at, p_relationship_updated_at
  )
  on conflict (discord_id) do update set
    familiarity = excluded.familiarity,
    warmth = excluded.warmth,
    patience = excluded.patience,
    banter = excluded.banter,
    trust = excluded.trust,
    preferred_style = excluded.preferred_style,
    relationship_summary = excluded.relationship_summary,
    recent_milestones = excluded.recent_milestones,
    interaction_count = excluded.interaction_count,
    summary_updated_at = excluded.summary_updated_at,
    updated_at = excluded.updated_at;

  insert into public.prisma_temperament (
    discord_id, mood, energy, sarcasm, affection, last_interaction_at, updated_at
  ) values (
    v_discord_id, p_mood, p_energy, p_sarcasm, p_affection, p_last_interaction_at, p_temperament_updated_at
  )
  on conflict (discord_id) do update set
    mood = excluded.mood,
    energy = excluded.energy,
    sarcasm = excluded.sarcasm,
    affection = excluded.affection,
    last_interaction_at = excluded.last_interaction_at,
    updated_at = excluded.updated_at;
end
$apply_prisma_state$;

revoke all on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) to service_role;

commit;
notify pgrst, 'reload schema';
