begin;

-- Estes arrays eram cópias de prisma_memories. O código agora calcula ambos
-- somente a partir de memórias ativas e dentro da validade.
insert into public.prisma_memories (user_id, memory_key, memory_type, content, importance, confidence)
select p.user_id, 'legacy-interest:' || md5(i.value), 'interest', left('Gosta de ' || i.value || '.', 300), 50, 60
from public.prisma_user_profiles p
cross join lateral jsonb_array_elements_text(p.interests) as i(value)
where char_length(trim(i.value)) between 3 and 280
on conflict do nothing;

insert into public.prisma_memories (user_id, memory_key, memory_type, content, importance, confidence)
select p.user_id, 'legacy-preference:' || md5(pref.value), 'preference', left(pref.value, 300), 50, 60
from public.prisma_user_profiles p
cross join lateral jsonb_array_elements_text(p.known_preferences) as pref(value)
where char_length(trim(pref.value)) between 3 and 300
on conflict do nothing;

alter table public.prisma_user_profiles
  drop column if exists interests,
  drop column if exists known_preferences;

commit;

notify pgrst, 'reload schema';
