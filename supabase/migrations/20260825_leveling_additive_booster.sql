begin;

alter table public.leveling_settings
  alter column booster_role_id set default '1538022012591538176';

update public.leveling_settings
set booster_role_id = '1538022012591538176'
where booster_role_id is null;

commit;
notify pgrst, 'reload schema';
