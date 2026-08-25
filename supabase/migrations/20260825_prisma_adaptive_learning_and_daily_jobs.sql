begin;

alter table public.prisma_self_learnings add column if not exists scope text not null default 'global';
alter table public.prisma_self_learnings add column if not exists user_id text;
alter table public.prisma_self_learnings add column if not exists occurrences integer not null default 0;
alter table public.prisma_self_learnings add column if not exists unique_users integer not null default 0;
alter table public.prisma_self_learnings add column if not exists different_days integer not null default 0;
alter table public.prisma_self_learnings drop constraint if exists prisma_self_learnings_scope_check;
alter table public.prisma_self_learnings add constraint prisma_self_learnings_scope_check check (scope in ('personal', 'global'));
alter table public.prisma_self_learnings drop constraint if exists prisma_self_learnings_status_check;
alter table public.prisma_self_learnings add constraint prisma_self_learnings_status_check check (status in ('candidate', 'active', 'inactive', 'archived', 'rejected'));
alter table public.prisma_self_learnings drop constraint if exists prisma_self_learnings_learning_key_key;
create unique index if not exists prisma_self_learnings_global_key_uidx on public.prisma_self_learnings (learning_key) where scope = 'global';
create unique index if not exists prisma_self_learnings_personal_key_uidx on public.prisma_self_learnings (user_id, learning_key) where scope = 'personal';
update public.prisma_self_learnings
set scope = 'global', user_id = null, occurrences = 0, unique_users = 0, different_days = 0,
    status = case when status = 'rejected' then 'rejected' else 'candidate' end;

create table if not exists public.prisma_self_learning_evidence (
  learning_id bigint not null references public.prisma_self_learnings(id) on delete cascade,
  user_id text not null,
  observed_date date not null,
  created_at timestamptz not null default now(),
  primary key (learning_id, user_id, observed_date)
);
create index if not exists prisma_self_learning_evidence_learning_idx on public.prisma_self_learning_evidence (learning_id);

create table if not exists public.prisma_daily_summary_jobs (
  user_id text not null,
  summary_date date not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  message_count integer not null default 0 check (message_count >= 0),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, summary_date)
);

create or replace function public.claim_prisma_daily_summary(
  p_user_id text,
  p_summary_date date,
  p_message_count integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $claim_prisma_daily_summary$
declare
  v_claimed boolean := false;
begin
  if p_user_id is null or btrim(p_user_id) = '' or p_summary_date is null or coalesce(p_message_count, 0) < 1 then
    raise exception 'Parâmetros inválidos para controle de resumo diário' using errcode = '22023';
  end if;
  insert into public.prisma_daily_summary_jobs (user_id, summary_date, status, started_at, completed_at, message_count, error, updated_at)
  values (p_user_id, p_summary_date, 'processing', now(), null, p_message_count, null, now())
  on conflict (user_id, summary_date) do update
  set status = 'processing', started_at = now(), completed_at = null, message_count = excluded.message_count, error = null, updated_at = now()
  where public.prisma_daily_summary_jobs.status <> 'completed'
    and (public.prisma_daily_summary_jobs.status <> 'processing' or public.prisma_daily_summary_jobs.started_at < now() - interval '30 minutes')
  returning true into v_claimed;
  return v_claimed;
end
$claim_prisma_daily_summary$;

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
  delete from public.ai_events where created_at < p_now - interval '30 days';
  delete from public.ai_usage where created_at < p_now - interval '90 days';
  delete from public.prisma_period_summaries where period_type = 'monthly' and period_end < (p_now - interval '365 days')::date;
  get diagnostics v_periods = row_count;
  update public.prisma_memories set status = 'forgotten', updated_at = p_now where status = 'active' and valid_until is not null and valid_until <= p_now;
  get diagnostics v_memories = row_count;
  delete from public.prisma_memories where (status = 'forgotten' and updated_at < p_now - interval '180 days') or (status = 'superseded' and updated_at < p_now - interval '365 days');
  get diagnostics v_historical = row_count;
  return jsonb_build_object('periods_deleted', v_periods, 'memories_forgotten', v_memories, 'historical_memories_deleted', v_historical);
end
$enforce_prisma_retention$;

create or replace function public.complete_prisma_daily_summary(
  p_user_id text,
  p_summary_date date,
  p_summary text,
  p_message_ids text[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $complete_prisma_daily_summary$
begin
  if p_user_id is null or btrim(p_user_id) = '' or p_summary_date is null or char_length(btrim(p_summary)) not between 3 and 1200 or coalesce(array_length(p_message_ids, 1), 0) = 0 then
    raise exception 'Parâmetros inválidos para resumo diário' using errcode = '22023';
  end if;
  insert into public.prisma_daily_summaries (user_id, summary_date, summary, updated_at)
  values (p_user_id, p_summary_date, left(btrim(p_summary), 1200), now())
  on conflict (user_id, summary_date) do update set summary = excluded.summary, updated_at = excluded.updated_at;
  update public.prisma_daily_summary_jobs
  set status = 'completed', completed_at = now(), message_count = cardinality(p_message_ids), error = null, updated_at = now()
  where user_id = p_user_id and summary_date = p_summary_date;
  if not found then
    insert into public.prisma_daily_summary_jobs (user_id, summary_date, status, completed_at, message_count)
    values (p_user_id, p_summary_date, 'completed', now(), cardinality(p_message_ids));
  end if;
  delete from public.prisma_messages where user_id = p_user_id and message_id = any(p_message_ids);
end
$complete_prisma_daily_summary$;

alter table public.prisma_self_learning_evidence enable row level security;
alter table public.prisma_daily_summary_jobs enable row level security;
revoke all on table public.prisma_self_learning_evidence, public.prisma_daily_summary_jobs from anon, authenticated;
grant all on table public.prisma_self_learning_evidence, public.prisma_daily_summary_jobs to service_role;
revoke all on function public.complete_prisma_daily_summary(text, date, text, text[]) from public, anon, authenticated;
revoke all on function public.claim_prisma_daily_summary(text, date, integer) from public, anon, authenticated;
grant execute on function public.complete_prisma_daily_summary(text, date, text, text[]) to service_role;
grant execute on function public.claim_prisma_daily_summary(text, date, integer) to service_role;

commit;
notify pgrst, 'reload schema';
