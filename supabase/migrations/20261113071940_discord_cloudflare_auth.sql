create table public.authorized_discord_uploaders (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  created_at timestamptz not null default now()
);

alter table public.authorized_discord_uploaders enable row level security;
revoke all on table public.authorized_discord_uploaders from anon, authenticated;
grant select on table public.authorized_discord_uploaders to service_role;

alter table public.audio_uploads
  alter column user_id drop not null,
  add column discord_user_id text
    check (discord_user_id is null or discord_user_id ~ '^[0-9]{17,20}$'),
  add constraint audio_uploads_has_owner
    check (user_id is not null or discord_user_id is not null);

create index audio_uploads_discord_user_created_at_idx
on public.audio_uploads (discord_user_id, created_at desc)
where discord_user_id is not null;

create table public.discord_audio_upload_rate_limits (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 10)
);

alter table public.discord_audio_upload_rate_limits enable row level security;
revoke all on table public.discord_audio_upload_rate_limits from anon, authenticated;
grant select, insert, update on table public.discord_audio_upload_rate_limits to service_role;

create function public.consume_discord_audio_upload_quota(p_discord_user_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  resulting_count integer;
begin
  insert into public.discord_audio_upload_rate_limits as current_limit (
    discord_user_id,
    window_start,
    request_count
  )
  values (p_discord_user_id, current_hour, 1)
  on conflict (discord_user_id) do update
  set
    window_start = case
      when current_limit.window_start < current_hour then current_hour
      else current_limit.window_start
    end,
    request_count = case
      when current_limit.window_start < current_hour then 1
      else current_limit.request_count + 1
    end
  where current_limit.window_start < current_hour
     or current_limit.request_count < 10
  returning request_count into resulting_count;

  return found;
end;
$function$;

revoke all on function public.consume_discord_audio_upload_quota(text) from public, anon, authenticated;
grant execute on function public.consume_discord_audio_upload_quota(text) to service_role;