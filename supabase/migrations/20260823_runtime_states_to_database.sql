begin;

create table if not exists public.paired_role_grants (
  guild_id text not null,
  user_id text not null,
  granted_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table if not exists public.punishment_role_snapshots (
  guild_id text not null,
  user_id text not null,
  role_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(role_ids) = 'array'),
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table if not exists public.booster_access_grants (
  guild_id text not null,
  user_id text not null,
  granted_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- Preserva quem já estava registrado no antigo paired-role-grants.json.
insert into public.paired_role_grants (guild_id, user_id)
select '1537989280838979677', user_id from unnest(array[
  '860519402793336833', '1455622336932745226', '740634843351875625',
  '862006843885879297', '1491632261404299324', '1119017806143443054',
  '541057787736883221', '833023284152631327', '1438644934327537834',
  '558417730487713794', '761023875638624257', '1057157892953878558',
  '1494765394311778325', '934188132134436965'
]) as user_id
on conflict (guild_id, user_id) do nothing;

-- Preserva quem já estava registrado no antigo booster-access-grants.json.
insert into public.booster_access_grants (guild_id, user_id)
values
  ('1537989280838979677', '1438644934327537834'),
  ('1537989280838979677', '558417730487713794')
on conflict (guild_id, user_id) do nothing;

alter table public.paired_role_grants enable row level security;
alter table public.punishment_role_snapshots enable row level security;
alter table public.booster_access_grants enable row level security;
revoke all on table public.paired_role_grants, public.punishment_role_snapshots, public.booster_access_grants from anon, authenticated;
grant all on table public.paired_role_grants, public.punishment_role_snapshots, public.booster_access_grants to service_role;

commit;
notify pgrst, 'reload schema';
