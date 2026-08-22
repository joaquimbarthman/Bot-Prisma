begin;

create index if not exists prisma_messages_created_idx on public.prisma_messages (created_at);
create index if not exists prisma_weekly_summaries_week_end_idx on public.prisma_weekly_summaries (week_end);
create index if not exists prisma_memories_active_valid_until_idx
  on public.prisma_memories (valid_until)
  where status = 'active' and valid_until is not null;

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
  on conflict (user_id, summary_date) do update set summary = excluded.summary, updated_at = excluded.updated_at;
  delete from public.prisma_messages
  where user_id = v_user_id and message_id = any(p_message_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$save_prisma_daily_summary$;

create or replace function public.enforce_prisma_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $enforce_prisma_retention$
declare
  v_history integer := 0;
  v_weekly integer := 0;
  v_memories integer := 0;
begin
  if p_now is null then raise exception 'p_now nao pode ser nulo' using errcode = '22023'; end if;
  perform public.consolidate_prisma_daily_summaries((p_now - interval '30 days')::date);
  delete from public.conversation_history where created_at < p_now - interval '48 hours';
  get diagnostics v_history = row_count;
  delete from public.ai_events where created_at < p_now - interval '48 hours';
  delete from public.ai_usage where created_at < p_now - interval '90 days';
  delete from public.prisma_weekly_summaries where week_end < (p_now - interval '365 days')::date;
  get diagnostics v_weekly = row_count;
  update public.prisma_memories set status = 'forgotten', updated_at = p_now
  where status = 'active' and valid_until is not null and valid_until <= p_now;
  get diagnostics v_memories = row_count;
  return jsonb_build_object('history_deleted', v_history, 'weekly_deleted', v_weekly, 'memories_forgotten', v_memories);
end
$enforce_prisma_retention$;

revoke all on function public.save_prisma_daily_summary(text, date, text, text[]) from public, anon, authenticated;
revoke all on function public.enforce_prisma_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.save_prisma_daily_summary(text, date, text, text[]) to service_role;
grant execute on function public.enforce_prisma_retention(timestamptz) to service_role;

commit;

notify pgrst, 'reload schema';
