begin;

create table if not exists public.user_settings (
  discord_id text primary key,
  nickname text not null default '',
  personality text not null default 'prisma_default',
  humor_level integer not null default 1 check (humor_level between 1 and 5),
  allow_mentions boolean not null default true,
  memory_enabled boolean not null default true,
  spontaneous_interactions boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- personality e humor_level permanecem temporariamente apenas para compatibilidade
-- com deploys antigos. O fluxo adaptativo não lê nem grava essas colunas.

create table if not exists public.prisma_relationships (
  discord_id text primary key,
  familiarity smallint not null default 10 check (familiarity between 0 and 100),
  warmth smallint not null default 50 check (warmth between 0 and 100),
  patience smallint not null default 60 check (patience between 0 and 100),
  banter smallint not null default 30 check (banter between 0 and 100),
  trust smallint not null default 30 check (trust between 0 and 100),
  preferred_style text,
  relationship_summary text check (char_length(relationship_summary) <= 300),
  recent_milestones jsonb not null default '[]'::jsonb check (jsonb_typeof(recent_milestones) = 'array' and jsonb_array_length(recent_milestones) <= 5),
  interaction_count integer not null default 0 check (interaction_count >= 0),
  summary_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prisma_temperament (
  discord_id text primary key,
  mood text not null default 'neutral' check (mood in ('neutral', 'playful', 'warm', 'calm', 'serious', 'energetic', 'annoyed')),
  energy smallint not null default 60 check (energy between 0 and 100),
  sarcasm smallint not null default 35 check (sarcasm between 0 and 100),
  affection smallint not null default 50 check (affection between 0 and 100),
  last_interaction_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Torna o bootstrap seguro para bancos onde uma versao anterior criou apenas
-- parte das tabelas adaptativas. Colunas obrigatorias recebem valores validos
-- antes de os NOT NULL e CHECKs serem (re)aplicados.
alter table public.prisma_relationships
  add column if not exists discord_id text,
  add column if not exists familiarity smallint not null default 10,
  add column if not exists warmth smallint not null default 50,
  add column if not exists patience smallint not null default 60,
  add column if not exists banter smallint not null default 30,
  add column if not exists trust smallint not null default 30,
  add column if not exists preferred_style text,
  add column if not exists relationship_summary text,
  add column if not exists recent_milestones jsonb not null default '[]'::jsonb,
  add column if not exists interaction_count integer not null default 0,
  add column if not exists summary_updated_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.prisma_relationships
set familiarity = greatest(0, least(100, coalesce(familiarity, 10))),
    warmth = greatest(0, least(100, coalesce(warmth, 50))),
    patience = greatest(0, least(100, coalesce(patience, 60))),
    banter = greatest(0, least(100, coalesce(banter, 30))),
    trust = greatest(0, least(100, coalesce(trust, 30))),
    relationship_summary = left(relationship_summary, 300),
    interaction_count = greatest(0, coalesce(interaction_count, 0)),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());

alter table public.prisma_relationships
  alter column familiarity set default 10,
  alter column familiarity set not null,
  alter column warmth set default 50,
  alter column warmth set not null,
  alter column patience set default 60,
  alter column patience set not null,
  alter column banter set default 30,
  alter column banter set not null,
  alter column trust set default 30,
  alter column trust set not null,
  alter column interaction_count set default 0,
  alter column interaction_count set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.prisma_relationships drop constraint if exists prisma_relationships_familiarity_check;
alter table public.prisma_relationships add constraint prisma_relationships_familiarity_check check (familiarity between 0 and 100);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_warmth_check;
alter table public.prisma_relationships add constraint prisma_relationships_warmth_check check (warmth between 0 and 100);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_patience_check;
alter table public.prisma_relationships add constraint prisma_relationships_patience_check check (patience between 0 and 100);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_banter_check;
alter table public.prisma_relationships add constraint prisma_relationships_banter_check check (banter between 0 and 100);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_trust_check;
alter table public.prisma_relationships add constraint prisma_relationships_trust_check check (trust between 0 and 100);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_relationship_summary_check;
alter table public.prisma_relationships add constraint prisma_relationships_relationship_summary_check check (char_length(relationship_summary) <= 300);
alter table public.prisma_relationships drop constraint if exists prisma_relationships_interaction_count_check;
alter table public.prisma_relationships add constraint prisma_relationships_interaction_count_check check (interaction_count >= 0);

alter table public.prisma_temperament
  add column if not exists discord_id text,
  add column if not exists mood text not null default 'neutral',
  add column if not exists energy smallint not null default 60,
  add column if not exists sarcasm smallint not null default 35,
  add column if not exists affection smallint not null default 50,
  add column if not exists last_interaction_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.prisma_temperament
set mood = case
      when mood in ('neutral', 'playful', 'warm', 'calm', 'serious', 'energetic', 'annoyed') then mood
      else 'neutral'
    end,
    energy = greatest(0, least(100, coalesce(energy, 60))),
    sarcasm = greatest(0, least(100, coalesce(sarcasm, 35))),
    affection = greatest(0, least(100, coalesce(affection, 50))),
    updated_at = coalesce(updated_at, now());

alter table public.prisma_temperament
  alter column mood set default 'neutral',
  alter column mood set not null,
  alter column energy set default 60,
  alter column energy set not null,
  alter column sarcasm set default 35,
  alter column sarcasm set not null,
  alter column affection set default 50,
  alter column affection set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.prisma_temperament drop constraint if exists prisma_temperament_mood_check;
alter table public.prisma_temperament add constraint prisma_temperament_mood_check check (mood in ('neutral', 'playful', 'warm', 'calm', 'serious', 'energetic', 'annoyed'));
alter table public.prisma_temperament drop constraint if exists prisma_temperament_energy_check;
alter table public.prisma_temperament add constraint prisma_temperament_energy_check check (energy between 0 and 100);
alter table public.prisma_temperament drop constraint if exists prisma_temperament_sarcasm_check;
alter table public.prisma_temperament add constraint prisma_temperament_sarcasm_check check (sarcasm between 0 and 100);
alter table public.prisma_temperament drop constraint if exists prisma_temperament_affection_check;
alter table public.prisma_temperament add constraint prisma_temperament_affection_check check (affection between 0 and 100);

do $adaptive_schema$
begin
  if not exists (select 1 from public.prisma_relationships where discord_id is null) then
    alter table public.prisma_relationships alter column discord_id set not null;
  end if;
  if not exists (select 1 from public.prisma_temperament where discord_id is null) then
    alter table public.prisma_temperament alter column discord_id set not null;
  end if;
end
$adaptive_schema$;

do $adaptive_unique_keys$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attname = 'discord_id'
    where c.conrelid = 'public.prisma_relationships'::pg_catalog.regclass
      and c.contype in ('p', 'u')
      and pg_catalog.array_length(c.conkey, 1) = 1
      and c.conkey[1] = a.attnum
  ) then
    create unique index if not exists prisma_relationships_discord_id_uidx
      on public.prisma_relationships (discord_id);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a
      on a.attrelid = c.conrelid and a.attname = 'discord_id'
    where c.conrelid = 'public.prisma_temperament'::pg_catalog.regclass
      and c.contype in ('p', 'u')
      and pg_catalog.array_length(c.conkey, 1) = 1
      and c.conkey[1] = a.attnum
  ) then
    create unique index if not exists prisma_temperament_discord_id_uidx
      on public.prisma_temperament (discord_id);
  end if;
end
$adaptive_unique_keys$;

create table if not exists public.conversation_history (
  id bigint generated by default as identity primary key,
  discord_id text not null,
  channel_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversation_history_user_created_idx on public.conversation_history (discord_id, created_at desc);
create index if not exists conversation_history_user_channel_created_idx on public.conversation_history (discord_id, channel_id, created_at desc, id desc);
create index if not exists conversation_history_created_idx on public.conversation_history (created_at);

create table if not exists public.ai_usage (
  id bigint generated by default as identity primary key,
  discord_id text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(14,8) not null default 0,
  estimated_cost_brl numeric(14,8) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);

create table if not exists public.ai_events (
  id bigint generated by default as identity primary key,
  discord_id text not null,
  interaction_type text not null default 'spontaneous',
  created_at timestamptz not null default now()
);
create index if not exists ai_events_user_created_idx on public.ai_events (discord_id, created_at desc);

-- Migração compatível para instalações que usavam os nomes e a escala antigos.
update public.user_settings set personality = case personality
  when 'padrao' then 'prisma_default'
  when 'sarcastico' then 'sarcastic'
  when 'fofo' then 'cute'
  when 'caotico' then 'chaotic'
  else personality
end;
alter table public.user_settings alter column personality set default 'prisma_default';
alter table public.user_settings drop constraint if exists user_settings_humor_level_check;
update public.user_settings set humor_level = greatest(1, least(5, humor_level));
alter table public.user_settings add constraint user_settings_humor_level_check check (humor_level between 1 and 5);
alter table public.user_settings alter column humor_level set default 1;

alter table public.user_settings enable row level security;
alter table public.conversation_history enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_events enable row level security;
alter table public.prisma_relationships enable row level security;
alter table public.prisma_temperament enable row level security;

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
begin
  if v_discord_id is null then
    raise exception 'p_discord_id nao pode ser vazio'
      using errcode = '22023';
  end if;

  insert into public.prisma_relationships (
    discord_id,
    familiarity,
    warmth,
    patience,
    banter,
    trust,
    preferred_style,
    relationship_summary,
    recent_milestones,
    interaction_count,
    summary_updated_at,
    created_at,
    updated_at
  ) values (
    v_discord_id,
    p_familiarity,
    p_warmth,
    p_patience,
    p_banter,
    p_trust,
    p_preferred_style,
    p_relationship_summary,
    p_recent_milestones,
    p_interaction_count,
    p_summary_updated_at,
    p_relationship_created_at,
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

  insert into public.prisma_temperament (
    discord_id,
    mood,
    energy,
    sarcasm,
    affection,
    last_interaction_at,
    updated_at
  ) values (
    v_discord_id,
    p_mood,
    p_energy,
    p_sarcasm,
    p_affection,
    p_last_interaction_at,
    p_temperament_updated_at
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
    raise exception 'p_discord_id nao pode ser vazio'
      using errcode = '22023';
  end if;

  delete from public.prisma_relationships where discord_id = v_discord_id;
  delete from public.prisma_temperament where discord_id = v_discord_id;
  if coalesce(p_clear_history, false) then
    delete from public.conversation_history where discord_id = v_discord_id;
  end if;
end
$reset_prisma_state$;

revoke all on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reset_prisma_state(text, boolean) from public, anon, authenticated;
grant execute on function public.apply_prisma_state(text, smallint, smallint, smallint, smallint, smallint, text, text, jsonb, integer, timestamptz, timestamptz, timestamptz, text, smallint, smallint, smallint, timestamptz, timestamptz) to service_role;
grant execute on function public.reset_prisma_state(text, boolean) to service_role;

commit;

notify pgrst, 'reload schema';

-- Não são criadas políticas públicas. O bot acessa as tabelas exclusivamente
-- pelo backend com SUPABASE_SECRET_KEY; nunca exponha essa chave ao Discord.
