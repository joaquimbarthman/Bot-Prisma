begin;

-- prisma_messages já contém as duas pontas de cada conversa, IDs reais do
-- Discord, canal, autor e encadeamento de resposta. Ela passa a ser a única
-- fonte do histórico recente e também a fila dos resumos.
drop table if exists public.conversation_history cascade;

-- Recupera vínculos que deixaram de ser persistidos pelo fluxo antigo. Conversa
-- registrada cria somente familiaridade e calor; confiança continua dependendo
-- de sinais explícitos avaliados pela Prisma em novas interações.
insert into public.prisma_relationships (
  discord_id, familiarity, warmth, patience, banter, trust,
  interaction_count, created_at, updated_at
)
select
  user_id,
  least(100, count(*)::integer),
  least(100, count(*)::integer),
  0,
  0,
  0,
  count(*)::integer,
  min(created_at),
  max(created_at)
from public.prisma_messages
where not author_is_prisma
group by user_id
on conflict (discord_id) do update set
  familiarity = greatest(public.prisma_relationships.familiarity, excluded.familiarity),
  warmth = greatest(public.prisma_relationships.warmth, excluded.warmth),
  interaction_count = greatest(public.prisma_relationships.interaction_count, excluded.interaction_count),
  updated_at = greatest(public.prisma_relationships.updated_at, excluded.updated_at);

create or replace function public.save_prisma_daily_summary(
  p_user_id text,
  p_summary_date date,
  p_summary text,
  p_message_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $save_prisma_daily_summary$
declare
  v_user_id text := nullif(pg_catalog.btrim(p_user_id), '');
  v_deleted integer := 0;
begin
  if v_user_id is null or p_summary_date is null or p_summary is null or char_length(pg_catalog.btrim(p_summary)) not between 3 and 1200 or coalesce(array_length(p_message_ids, 1), 0) = 0 then
    raise exception 'Parametros invalidos' using errcode = '22023';
  end if;
  insert into public.prisma_daily_summaries (user_id, summary_date, summary, updated_at)
  values (v_user_id, p_summary_date, pg_catalog.btrim(p_summary), now())
  on conflict (user_id, summary_date) do update set
    summary = right(public.prisma_daily_summaries.summary || E'\n' || excluded.summary, 1200),
    updated_at = excluded.updated_at;
  delete from public.prisma_messages where user_id = v_user_id and message_id = any(p_message_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$save_prisma_daily_summary$;

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
  if v_discord_id is null then raise exception 'p_discord_id nao pode ser vazio' using errcode = '22023'; end if;
  delete from public.prisma_relationships where discord_id = v_discord_id;
  delete from public.prisma_emotional_states where user_id = v_discord_id;
  if coalesce(p_clear_history, false) then delete from public.prisma_messages where user_id = v_discord_id; end if;
end
$reset_prisma_state$;

create or replace function public.enforce_prisma_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $enforce_prisma_retention$
declare
  v_periods integer := 0;
  v_memories integer := 0;
  v_historical integer := 0;
begin
  if p_now is null then raise exception 'p_now nao pode ser nulo' using errcode = '22023'; end if;
  perform public.consolidate_prisma_summaries((p_now - interval '7 days')::date, (p_now - interval '90 days')::date);
  -- prisma_messages não é apagada aqui: save_prisma_daily_summary remove cada
  -- lote somente depois de o respectivo resumo ter sido salvo com sucesso.
  delete from public.ai_events where created_at < p_now - interval '24 hours';
  delete from public.ai_usage where created_at < p_now - interval '90 days';
  delete from public.prisma_period_summaries
  where period_type = 'monthly' and period_end < (p_now - interval '365 days')::date;
  get diagnostics v_periods = row_count;
  update public.prisma_memories set status = 'forgotten', updated_at = p_now
  where status = 'active' and valid_until is not null and valid_until <= p_now;
  get diagnostics v_memories = row_count;
  delete from public.prisma_memories
  where (status = 'forgotten' and updated_at < p_now - interval '180 days')
     or (status = 'superseded' and updated_at < p_now - interval '365 days');
  get diagnostics v_historical = row_count;
  return jsonb_build_object(
    'periods_deleted', v_periods,
    'memories_forgotten', v_memories,
    'historical_memories_deleted', v_historical
  );
end
$enforce_prisma_retention$;

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
  if p_scope in ('history', 'all') then delete from public.prisma_messages where user_id = v_user_id; end if;
  if p_scope in ('memories', 'all') then
    delete from public.prisma_memories where user_id = v_user_id;
    delete from public.prisma_user_profiles where user_id = v_user_id;
    delete from public.prisma_daily_summaries where user_id = v_user_id;
    delete from public.prisma_period_summaries where user_id = v_user_id;
  end if;
  if p_scope in ('relationship', 'all') then
    delete from public.prisma_relationships where discord_id = v_user_id;
    delete from public.prisma_emotional_states where user_id = v_user_id;
  end if;
end
$delete_prisma_user_data$;

revoke all on function public.enforce_prisma_retention(timestamptz) from public, anon, authenticated;
revoke all on function public.delete_prisma_user_data(text, text) from public, anon, authenticated;
revoke all on function public.reset_prisma_state(text, boolean) from public, anon, authenticated;
revoke all on function public.save_prisma_daily_summary(text, date, text, text[]) from public, anon, authenticated;
grant execute on function public.enforce_prisma_retention(timestamptz) to service_role;
grant execute on function public.delete_prisma_user_data(text, text) to service_role;
grant execute on function public.reset_prisma_state(text, boolean) to service_role;
grant execute on function public.save_prisma_daily_summary(text, date, text, text[]) to service_role;

commit;
notify pgrst, 'reload schema';
