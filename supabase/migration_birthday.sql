alter table public.user_settings add column if not exists birthday text;
alter table public.user_settings add column if not exists birthday_greeted_on date;
alter table public.user_settings drop constraint if exists user_settings_birthday_check;
alter table public.user_settings add constraint user_settings_birthday_check
  check (birthday is null or birthday ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])$');
