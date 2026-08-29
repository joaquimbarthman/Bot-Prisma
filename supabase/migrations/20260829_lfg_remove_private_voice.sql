alter table public.lfg_sessions
  drop column if exists auto_voice_enabled,
  drop column if exists voice_channel_id,
  drop column if exists temporary_role_id,
  drop column if exists delete_voice_when_empty;
