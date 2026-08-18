begin;

alter table public.user_settings
  add column if not exists about_me text not null default '';

alter table public.user_settings
  drop constraint if exists user_settings_about_me_length;

alter table public.user_settings
  add constraint user_settings_about_me_length check (char_length(about_me) <= 160);

commit;
