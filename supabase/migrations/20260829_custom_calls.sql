create table if not exists public.custom_calls (
  id uuid primary key,
  guild_id text not null,
  owner_id text not null,
  voice_channel_id text not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, owner_id)
);

create table if not exists public.custom_call_members (
  id uuid primary key,
  custom_call_id uuid not null references public.custom_calls(id) on delete cascade,
  user_id text not null,
  added_at timestamptz not null default now(),
  unique (custom_call_id, user_id)
);

create table if not exists public.custom_call_access (
  guild_id text not null,
  user_id text not null,
  booster_access boolean not null default false,
  manual_access boolean not null default false,
  source_role_grant_processed boolean not null default false,
  source_role_access boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create index if not exists custom_call_members_call_idx on public.custom_call_members (custom_call_id);
alter table public.custom_calls enable row level security;
alter table public.custom_call_members enable row level security;
alter table public.custom_call_access enable row level security;
revoke all on table public.custom_calls, public.custom_call_members, public.custom_call_access from anon, authenticated;
grant all on table public.custom_calls, public.custom_call_members, public.custom_call_access to service_role;
