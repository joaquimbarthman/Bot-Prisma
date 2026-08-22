begin;

create index if not exists prisma_memories_historical_retention_idx
  on public.prisma_memories (status, updated_at)
  where status in ('superseded','forgotten');

create or replace function public.enforce_prisma_retention(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $enforce_prisma_retention$
declare
  v_history integer := 0;
  v_periods integer := 0;
  v_memories integer := 0;
  v_historical integer := 0;
begin
  if p_now is null then raise exception 'p_now nao pode ser nulo' using errcode = '22023'; end if;
  perform public.consolidate_prisma_summaries((p_now - interval '7 days')::date, (p_now - interval '90 days')::date);
  delete from public.conversation_history where created_at < p_now - interval '48 hours';
  get diagnostics v_history = row_count;
  delete from public.ai_events where created_at < p_now - interval '48 hours';
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
    'history_deleted', v_history,
    'periods_deleted', v_periods,
    'memories_forgotten', v_memories,
    'historical_memories_deleted', v_historical
  );
end
$enforce_prisma_retention$;

revoke all on function public.enforce_prisma_retention(timestamptz) from public, anon, authenticated;
grant execute on function public.enforce_prisma_retention(timestamptz) to service_role;

commit;
notify pgrst, 'reload schema';
