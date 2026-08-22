begin;

-- Uma linha por pessoa passa a concentrar emoções e temperamento.
alter table public.prisma_emotional_states
  add column if not exists mood text not null default 'neutral',
  add column if not exists sarcasm smallint not null default 35,
  add column if not exists last_interaction_at timestamptz;

alter table public.prisma_emotional_states drop constraint if exists prisma_emotional_states_mood_check;
alter table public.prisma_emotional_states
  add constraint prisma_emotional_states_mood_check
  check (mood in ('neutral', 'playful', 'warm', 'calm', 'serious', 'energetic', 'annoyed'));
alter table public.prisma_emotional_states drop constraint if exists prisma_emotional_states_sarcasm_check;
alter table public.prisma_emotional_states
  add constraint prisma_emotional_states_sarcasm_check check (sarcasm between 0 and 100);

-- Preserva todo temperamento existente. Emoções já registradas continuam
-- sendo a fonte de energia/afeto; mood, sarcasmo e interação vêm da tabela antiga.
insert into public.prisma_emotional_states (
  user_id, mood, energy, sarcasm, affection, last_interaction_at, updated_at
)
select discord_id, mood, energy, sarcasm, affection, last_interaction_at, updated_at
from public.prisma_temperament
on conflict (user_id) do update set
  mood = excluded.mood,
  sarcasm = excluded.sarcasm,
  last_interaction_at = excluded.last_interaction_at,
  updated_at = greatest(public.prisma_emotional_states.updated_at, excluded.updated_at);

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
begin
  if v_discord_id is null then
    raise exception 'p_discord_id nao pode ser vazio' using errcode = '22023';
  end if;

  insert into public.prisma_relationships (
    discord_id, familiarity, warmth, patience, banter, trust, preferred_style,
    relationship_summary, recent_milestones, interaction_count,
    summary_updated_at, created_at, updated_at
  ) values (
    v_discord_id, p_familiarity, p_warmth, p_patience, p_banter, p_trust,
    p_preferred_style, p_relationship_summary, p_recent_milestones,
    p_interaction_count, p_summary_updated_at, p_relationship_created_at,
    p_relationship_updated_at
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

create or replace function public.reset_prisma_state(
  p_discord_id text,
  p_clear_history boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $reset_prisma_state$
declare
  v_discord_id text := nullif(pg_catalog.btrim(p_discord_id), '');
begin
  if v_discord_id is null then
    raise exception 'p_discord_id nao pode ser vazio' using errcode = '22023';
  end if;
  delete from public.prisma_relationships where discord_id = v_discord_id;
  delete from public.prisma_emotional_states where user_id = v_discord_id;
  if coalesce(p_clear_history, false) then
    delete from public.conversation_history where discord_id = v_discord_id;
  end if;
end
$reset_prisma_state$;

create or replace function public.delete_prisma_user_data(p_user_id text, p_scope text)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $delete_prisma_user_data$
declare
  v_user_id text := nullif(pg_catalog.btrim(p_user_id), '');
begin
  if v_user_id is null or p_scope not in ('history', 'memories', 'relationship', 'all') then
    raise exception 'Parametros invalidos' using errcode = '22023';
  end if;
  if p_scope in ('history', 'all') then delete from public.prisma_messages where user_id = v_user_id; delete from public.conversation_history where discord_id = v_user_id; end if;
  if p_scope in ('memories', 'all') then delete from public.prisma_memories where user_id = v_user_id; delete from public.prisma_user_profiles where user_id = v_user_id; delete from public.prisma_daily_summaries where user_id = v_user_id; end if;
  if p_scope in ('relationship', 'all') then delete from public.prisma_relationships where discord_id = v_user_id; delete from public.prisma_emotional_states where user_id = v_user_id; end if;
end
$delete_prisma_user_data$;

drop table public.prisma_temperament;

revoke all on table public.prisma_emotional_states from anon, authenticated;
grant all on table public.prisma_emotional_states to service_role;
revoke all on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reset_prisma_state(text, boolean) from public, anon, authenticated;
revoke all on function public.delete_prisma_user_data(text, text) from public, anon, authenticated;
grant execute on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) to service_role;
grant execute on function public.reset_prisma_state(text, boolean) to service_role;
grant execute on function public.delete_prisma_user_data(text, text) to service_role;

commit;

notify pgrst, 'reload schema';
