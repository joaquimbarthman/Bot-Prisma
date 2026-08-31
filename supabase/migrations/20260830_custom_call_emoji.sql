alter table public.custom_calls
  add column if not exists emoji text not null default '💦';
