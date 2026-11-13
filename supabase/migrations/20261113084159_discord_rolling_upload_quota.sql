alter table public.discord_audio_upload_rate_limits
  add column upload_timestamps timestamptz[] not null default '{}'::timestamptz[];

update public.discord_audio_upload_rate_limits
set upload_timestamps = pg_catalog.array_fill(
  window_start,
  array[least(request_count, 5)]
);

alter table public.discord_audio_upload_rate_limits
  add constraint discord_audio_upload_rate_limits_max_five_recent
    check (pg_catalog.cardinality(upload_timestamps) <= 5),
  drop column window_start,
  drop column request_count;

create or replace function public.consume_discord_audio_upload_quota(p_discord_user_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  checked_at timestamptz := pg_catalog.now();
  stored_uploads timestamptz[];
  recent_uploads timestamptz[];
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid Discord user ID.'
      using errcode = '22023';
  end if;

  insert into public.discord_audio_upload_rate_limits (
    discord_user_id,
    upload_timestamps
  )
  values (p_discord_user_id, '{}'::timestamptz[])
  on conflict (discord_user_id) do nothing;

  select rate_limits.upload_timestamps
  into stored_uploads
  from public.discord_audio_upload_rate_limits as rate_limits
  where rate_limits.discord_user_id = p_discord_user_id
  for update;

  select coalesce(
    pg_catalog.array_agg(upload.uploaded_at order by upload.uploaded_at),
    '{}'::timestamptz[]
  )
  into recent_uploads
  from pg_catalog.unnest(stored_uploads) as upload(uploaded_at)
  where upload.uploaded_at > checked_at - interval '24 hours';

  if pg_catalog.cardinality(recent_uploads) >= 5 then
    update public.discord_audio_upload_rate_limits
    set upload_timestamps = recent_uploads
    where discord_user_id = p_discord_user_id;
    return false;
  end if;

  update public.discord_audio_upload_rate_limits
  set upload_timestamps = pg_catalog.array_append(recent_uploads, checked_at)
  where discord_user_id = p_discord_user_id;

  return true;
end;
$function$;
