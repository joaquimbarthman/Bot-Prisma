begin;

alter table public.gallery_posts
  add column if not exists comments jsonb not null default '[]'::jsonb,
  add column if not exists instagram_handle text;

alter table public.gallery_posts
  drop constraint if exists gallery_posts_comments_array;

alter table public.gallery_posts
  add constraint gallery_posts_comments_array check (jsonb_typeof(comments) = 'array');

commit;
