begin;

create or replace function public.consolidate_prisma_summaries(p_daily_before date, p_weekly_before date)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $consolidate_prisma_summaries$
declare
  v_weekly integer := 0;
  v_monthly integer := 0;
begin
  if p_daily_before is null or p_weekly_before is null or p_weekly_before >= p_daily_before then
    raise exception 'Cortes de consolidacao invalidos' using errcode = '22023';
  end if;

  with weekly_source as (
    select d.user_id, d.summary_date, d.summary,
      date_trunc('week', d.summary_date::timestamp)::date as rollup_start
    from public.prisma_daily_summaries d
    where d.summary_date < p_daily_before
  ), weekly_rollup as (
    select user_id, rollup_start, rollup_start + 6 as rollup_end,
      left(string_agg(to_char(summary_date, 'YYYY-MM-DD') || ': ' || summary, E'\n' order by summary_date), 4000) as rollup_summary
    from weekly_source
    group by user_id, rollup_start
  )
  insert into public.prisma_period_summaries (user_id, period_type, period_start, period_end, summary, updated_at)
  select user_id, 'weekly', rollup_start, rollup_end, rollup_summary, now()
  from weekly_rollup
  on conflict (user_id, period_type, period_start) do update set
    summary = left(public.prisma_period_summaries.summary || E'\n' || excluded.summary, 4000),
    period_end = excluded.period_end,
    updated_at = excluded.updated_at;
  get diagnostics v_weekly = row_count;
  delete from public.prisma_daily_summaries where summary_date < p_daily_before;

  with monthly_source as (
    select p.user_id, p.period_start, p.summary,
      date_trunc('month', p.period_start::timestamp)::date as rollup_start
    from public.prisma_period_summaries p
    where p.period_type = 'weekly' and p.period_end < p_weekly_before
  ), monthly_rollup as (
    select user_id, rollup_start,
      (rollup_start + interval '1 month - 1 day')::date as rollup_end,
      left(string_agg(to_char(period_start, 'YYYY-MM-DD') || ': ' || summary, E'\n' order by period_start), 8000) as rollup_summary
    from monthly_source
    group by user_id, rollup_start
  )
  insert into public.prisma_period_summaries (user_id, period_type, period_start, period_end, summary, updated_at)
  select user_id, 'monthly', rollup_start, rollup_end, rollup_summary, now()
  from monthly_rollup
  on conflict (user_id, period_type, period_start) do update set
    summary = left(public.prisma_period_summaries.summary || E'\n' || excluded.summary, 8000),
    period_end = excluded.period_end,
    updated_at = excluded.updated_at;
  get diagnostics v_monthly = row_count;
  delete from public.prisma_period_summaries where period_type = 'weekly' and period_end < p_weekly_before;

  return jsonb_build_object('weekly_upserted', v_weekly, 'monthly_upserted', v_monthly);
end
$consolidate_prisma_summaries$;

revoke all on function public.consolidate_prisma_summaries(date, date) from public, anon, authenticated;
grant execute on function public.consolidate_prisma_summaries(date, date) to service_role;

commit;
notify pgrst, 'reload schema';
