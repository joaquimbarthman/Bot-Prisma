begin;

create table if not exists public.gallery_posts (
  message_id text primary key,
  owner_id text not null,
  likes jsonb not null default '[]'::jsonb,
  report_pending boolean not null default false,
  report_disabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint gallery_posts_likes_array check (jsonb_typeof(likes) = 'array')
);

create index if not exists gallery_posts_owner_idx on public.gallery_posts(owner_id);

alter table public.gallery_posts enable row level security;
revoke all on table public.gallery_posts from anon, authenticated;
grant all on table public.gallery_posts to service_role;

commit;
