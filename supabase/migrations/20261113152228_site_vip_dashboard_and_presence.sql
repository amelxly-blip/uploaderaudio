create table public.site_discord_visitors (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  username text not null check (char_length(username) between 1 and 100),
  display_name text not null check (char_length(display_name) between 1 and 100),
  avatar_url text not null default ''
    check (avatar_url = '' or avatar_url like 'https://cdn.discordapp.com/avatars/%'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index site_discord_visitors_last_seen_at_idx
  on public.site_discord_visitors (last_seen_at desc);

create table public.site_vip_entitlements (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  granted_by text not null default 'admin'
    check (char_length(granted_by) between 1 and 100)
);

create index site_vip_entitlements_active_idx
  on public.site_vip_entitlements (expires_at);

create table public.site_user_bans (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  banned_at timestamptz not null default now(),
  banned_by text not null default 'admin'
    check (char_length(banned_by) between 1 and 100),
  reason text not null default ''
    check (char_length(reason) <= 200)
);

create table public.site_admin_audit_log (
  id bigint generated always as identity primary key,
  action text not null
    check (action in ('grant_vip', 'revoke_vip', 'ban_user', 'unban_user')),
  target_discord_user_id text not null
    check (target_discord_user_id ~ '^[0-9]{17,20}$'),
  admin_label text not null default 'admin'
    check (char_length(admin_label) between 1 and 100),
  details jsonb not null default '{}'::jsonb
    check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table public.site_global_stats (
  id smallint primary key default 1 check (id = 1),
  unique_visitors bigint not null default 0
    check (unique_visitors >= 0),
  successful_uploads bigint not null default 0
    check (successful_uploads >= 0),
  updated_at timestamptz not null default now()
);

create table public.site_admin_login_limits (
  address_hash text primary key check (address_hash ~ '^[0-9a-f]{64}$'),
  attempts timestamptz[] not null default '{}'::timestamptz[],
  updated_at timestamptz not null default now()
);

create index site_admin_login_limits_updated_at_idx
  on public.site_admin_login_limits (updated_at);

insert into public.site_global_stats (id, unique_visitors, successful_uploads)
select
  1,
  (select count(*)::bigint from public.site_discord_visitors),
  (select count(*)::bigint from public.audio_uploads where status = 'completed' and asset_id is not null);

alter table public.site_discord_visitors enable row level security;
alter table public.site_vip_entitlements enable row level security;
alter table public.site_user_bans enable row level security;
alter table public.site_admin_audit_log enable row level security;
alter table public.site_global_stats enable row level security;
alter table public.site_admin_login_limits enable row level security;

revoke all on table
  public.site_discord_visitors,
  public.site_vip_entitlements,
  public.site_user_bans,
  public.site_admin_audit_log,
  public.site_global_stats,
  public.site_admin_login_limits
from anon, authenticated;

grant select, insert, update, delete on table
  public.site_discord_visitors,
  public.site_vip_entitlements,
  public.site_user_bans,
  public.site_admin_audit_log
to service_role;
grant select, insert, update on table public.site_global_stats to service_role;
grant select, insert, update, delete on table public.site_admin_login_limits to service_role;
revoke all on sequence public.site_admin_audit_log_id_seq from anon, authenticated;
grant usage, select on sequence public.site_admin_audit_log_id_seq to service_role;

create function public.record_site_discord_visitor(
  p_discord_user_id text,
  p_username text,
  p_display_name text,
  p_avatar_url text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$'
    or p_username is null or pg_catalog.char_length(p_username) not between 1 and 100
    or p_display_name is null or pg_catalog.char_length(p_display_name) not between 1 and 100
    or p_avatar_url is null
    or (p_avatar_url <> '' and p_avatar_url not like 'https://cdn.discordapp.com/avatars/%')
  then
    raise exception 'Invalid Discord visitor profile.'
      using errcode = '22023';
  end if;

  insert into public.site_discord_visitors (
    discord_user_id,
    username,
    display_name,
    avatar_url
  )
  values (
    p_discord_user_id,
    p_username,
    p_display_name,
    p_avatar_url
  )
  on conflict (discord_user_id) do update
  set
    username = excluded.username,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    last_seen_at = pg_catalog.now();
end;
$function$;

create function public.count_site_discord_visitor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.site_global_stats
  set
    unique_visitors = unique_visitors + 1,
    updated_at = pg_catalog.now()
  where id = 1;
  return new;
end;
$function$;

create trigger site_discord_visitors_count_unique
  after insert on public.site_discord_visitors
  for each row execute function public.count_site_discord_visitor();
revoke all on function public.count_site_discord_visitor()
  from public, anon, authenticated;
grant execute on function public.count_site_discord_visitor()
  to service_role;

revoke all on function public.record_site_discord_visitor(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_site_discord_visitor(text, text, text, text)
  to service_role;

create function public.get_site_dashboard(
  p_discord_user_id text,
  p_username text,
  p_display_name text,
  p_avatar_url text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  checked_at timestamptz := pg_catalog.now();
  vip_expiry timestamptz;
  upload_timestamps timestamptz[] := '{}'::timestamptz[];
  unique_visitors bigint;
  successful_uploads bigint;
begin
  perform public.record_site_discord_visitor(
    p_discord_user_id,
    p_username,
    p_display_name,
    p_avatar_url
  );

  select stats.unique_visitors, stats.successful_uploads
  into unique_visitors, successful_uploads
  from public.site_global_stats as stats
  where stats.id = 1;

  select vip.expires_at
  into vip_expiry
  from public.site_vip_entitlements as vip
  where vip.discord_user_id = p_discord_user_id;

  select coalesce(
    pg_catalog.array_agg(upload.uploaded_at order by upload.uploaded_at),
    '{}'::timestamptz[]
  )
  into upload_timestamps
  from public.discord_audio_upload_rate_limits as limits
  cross join lateral pg_catalog.unnest(limits.upload_timestamps) as upload(uploaded_at)
  where limits.discord_user_id = p_discord_user_id
    and upload.uploaded_at > checked_at - interval '24 hours';

  return pg_catalog.jsonb_build_object(
    'totalVisitors', unique_visitors,
    'totalVip', (
      select count(*)::bigint
      from public.site_vip_entitlements as active_vip
      where active_vip.expires_at > checked_at
    ),
    'totalUploads', successful_uploads,
    'isVip', coalesce(vip_expiry > checked_at, false),
    'vipExpiresAt', case when vip_expiry > checked_at then vip_expiry else null end,
    'quotaLimit', 5,
    'quotaRemaining', case
      when vip_expiry > checked_at then null
      when pg_catalog.cardinality(upload_timestamps) >= 5 then 0
      else 5 - pg_catalog.cardinality(upload_timestamps)
    end
  );
end;
$function$;

revoke all on function public.get_site_dashboard(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_site_dashboard(text, text, text, text)
  to service_role;

create function public.count_completed_site_upload()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status = 'completed'
    and new.asset_id is not null
    and (old.status is distinct from new.status or old.asset_id is null)
  then
    update public.site_global_stats
    set
      successful_uploads = successful_uploads + 1,
      updated_at = pg_catalog.now()
    where id = 1;
  end if;
  return new;
end;
$function$;

create trigger audio_uploads_count_site_completion
  after update of status, asset_id on public.audio_uploads
  for each row execute function public.count_completed_site_upload();
revoke all on function public.count_completed_site_upload()
  from public, anon, authenticated;
grant execute on function public.count_completed_site_upload()
  to service_role;

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

  if exists (
    select 1
    from public.site_vip_entitlements as vip
    where vip.discord_user_id = p_discord_user_id
      and vip.expires_at > checked_at
  ) then
    return true;
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

create function public.reset_discord_audio_upload_quota(p_discord_user_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.discord_audio_upload_rate_limits
  set upload_timestamps = '{}'::timestamptz[]
  where discord_user_id = p_discord_user_id;
end;
$function$;

create function public.grant_site_vip(
  p_discord_user_id text,
  p_duration_days integer
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  checked_at timestamptz := pg_catalog.now();
  resulting_expiry timestamptz;
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$'
    or p_duration_days not in (7, 30, 60)
  then
    raise exception 'Invalid VIP grant.'
      using errcode = '22023';
  end if;

  insert into public.site_vip_entitlements as current_vip (
    discord_user_id,
    granted_at,
    expires_at,
    granted_by
  )
  values (
    p_discord_user_id,
    checked_at,
    checked_at + pg_catalog.make_interval(days => p_duration_days),
    'admin'
  )
  on conflict (discord_user_id) do update
  set
    granted_at = checked_at,
    expires_at = case
      when current_vip.expires_at > checked_at then current_vip.expires_at
      else checked_at
    end
      + pg_catalog.make_interval(days => p_duration_days),
    granted_by = 'admin'
  returning expires_at into resulting_expiry;

  perform public.reset_discord_audio_upload_quota(p_discord_user_id);
  insert into public.site_admin_audit_log (action, target_discord_user_id, details)
  values (
    'grant_vip',
    p_discord_user_id,
    pg_catalog.jsonb_build_object('durationDays', p_duration_days, 'expiresAt', resulting_expiry)
  );

  return resulting_expiry;
end;
$function$;

create function public.revoke_site_vip(p_discord_user_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid Discord user ID.'
      using errcode = '22023';
  end if;

  delete from public.site_vip_entitlements
  where discord_user_id = p_discord_user_id;
  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    perform public.reset_discord_audio_upload_quota(p_discord_user_id);
    insert into public.site_admin_audit_log (action, target_discord_user_id)
    values ('revoke_vip', p_discord_user_id);
  end if;

  return affected_rows > 0;
end;
$function$;

create function public.ban_site_discord_user(
  p_discord_user_id text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$'
    or p_reason is null or pg_catalog.char_length(p_reason) > 200
  then
    raise exception 'Invalid Discord user ban.'
      using errcode = '22023';
  end if;

  insert into public.site_user_bans (discord_user_id, banned_by, reason)
  values (p_discord_user_id, 'admin', p_reason)
  on conflict (discord_user_id) do update
  set banned_at = pg_catalog.now(), banned_by = 'admin', reason = excluded.reason;

  insert into public.site_admin_audit_log (action, target_discord_user_id, details)
  values ('ban_user', p_discord_user_id, pg_catalog.jsonb_build_object('reason', p_reason));
end;
$function$;

create function public.unban_site_discord_user(p_discord_user_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  affected_rows integer;
begin
  if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid Discord user ID.'
      using errcode = '22023';
  end if;

  delete from public.site_user_bans
  where discord_user_id = p_discord_user_id;
  get diagnostics affected_rows = row_count;

  if affected_rows > 0 then
    insert into public.site_admin_audit_log (action, target_discord_user_id)
    values ('unban_user', p_discord_user_id);
  end if;

  return affected_rows > 0;
end;
$function$;

create function public.consume_site_admin_login_attempt(p_address_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  checked_at timestamptz := pg_catalog.now();
  stored_attempts timestamptz[];
  recent_attempts timestamptz[];
begin
  if p_address_hash is null or p_address_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid admin login fingerprint.'
      using errcode = '22023';
  end if;

  delete from public.site_admin_login_limits
  where updated_at < checked_at - interval '24 hours';

  insert into public.site_admin_login_limits (address_hash, attempts)
  values (p_address_hash, '{}'::timestamptz[])
  on conflict (address_hash) do nothing;

  select limits.attempts
  into stored_attempts
  from public.site_admin_login_limits as limits
  where limits.address_hash = p_address_hash
  for update;

  select coalesce(
    pg_catalog.array_agg(attempt.attempted_at order by attempt.attempted_at),
    '{}'::timestamptz[]
  )
  into recent_attempts
  from pg_catalog.unnest(stored_attempts) as attempt(attempted_at)
  where attempt.attempted_at > checked_at - interval '15 minutes';

  if pg_catalog.cardinality(recent_attempts) >= 5 then
    update public.site_admin_login_limits
    set attempts = recent_attempts, updated_at = checked_at
    where address_hash = p_address_hash;
    return false;
  end if;

  update public.site_admin_login_limits
  set attempts = pg_catalog.array_append(recent_attempts, checked_at), updated_at = checked_at
  where address_hash = p_address_hash;
  return true;
end;
$function$;

create function public.reset_site_admin_login_attempts(p_address_hash text)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_address_hash is null or p_address_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid admin login fingerprint.'
      using errcode = '22023';
  end if;
  delete from public.site_admin_login_limits where address_hash = p_address_hash;
end;
$function$;

revoke all on function public.consume_discord_audio_upload_quota(text)
  from public, anon, authenticated;
grant execute on function public.consume_discord_audio_upload_quota(text)
  to service_role;
revoke all on function public.reset_discord_audio_upload_quota(text)
  from public, anon, authenticated;
grant execute on function public.reset_discord_audio_upload_quota(text)
  to service_role;
revoke all on function public.grant_site_vip(text, integer)
  from public, anon, authenticated;
grant execute on function public.grant_site_vip(text, integer)
  to service_role;
revoke all on function public.revoke_site_vip(text)
  from public, anon, authenticated;
grant execute on function public.revoke_site_vip(text)
  to service_role;
revoke all on function public.ban_site_discord_user(text, text)
  from public, anon, authenticated;
grant execute on function public.ban_site_discord_user(text, text)
  to service_role;
revoke all on function public.unban_site_discord_user(text)
  from public, anon, authenticated;
grant execute on function public.unban_site_discord_user(text)
  to service_role;
revoke all on function public.consume_site_admin_login_attempt(text)
  from public, anon, authenticated;
grant execute on function public.consume_site_admin_login_attempt(text)
  to service_role;
revoke all on function public.reset_site_admin_login_attempts(text)
  from public, anon, authenticated;
grant execute on function public.reset_site_admin_login_attempts(text)
  to service_role;