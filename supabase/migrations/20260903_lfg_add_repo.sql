begin;

alter table public.lfg_sessions
  drop constraint if exists lfg_sessions_game_check;

alter table public.lfg_sessions
  add constraint lfg_sessions_game_check
  check (game in (
    'fortnite',
    'genshin_impact',
    'valorant',
    'roblox',
    'overwatch',
    'league_of_legends',
    'minecraft',
    'marvel_rivals',
    'dead_by_daylight',
    'repo'
  ));

commit;

notify pgrst, 'reload schema';
