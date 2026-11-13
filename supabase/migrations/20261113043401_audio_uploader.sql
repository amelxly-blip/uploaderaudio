create table public.authorized_uploaders (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.authorized_uploaders enable row level security;

revoke all on table public.authorized_uploaders from anon, authenticated;
grant select on table public.authorized_uploaders to authenticated;
grant all on table public.authorized_uploaders to service_role;

create policy "uploaders can read their own access"
on public.authorized_uploaders
for select
to authenticated
using ((select auth.uid()) = user_id);

create table public.audio_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  file_size integer not null check (file_size between 1 and 20971520),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  operation_path text,
  asset_id text check (asset_id is null or asset_id ~ '^[0-9]+$'),
  error_message text,
  created_at timestamptz not null default now()
);

create index audio_uploads_user_created_at_idx
on public.audio_uploads (user_id, created_at desc);

alter table public.audio_uploads enable row level security;

revoke all on table public.audio_uploads from anon, authenticated;
grant select on table public.audio_uploads to authenticated;
grant all on table public.audio_uploads to service_role;

create policy "uploaders can read their own upload history"
on public.audio_uploads
for select
to authenticated
using ((select auth.uid()) = user_id);

create table public.audio_upload_rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count between 1 and 10)
);

alter table public.audio_upload_rate_limits enable row level security;
revoke all on table public.audio_upload_rate_limits from anon, authenticated;
grant select, insert, update on table public.audio_upload_rate_limits to service_role;

create function public.consume_audio_upload_quota(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_hour timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  resulting_count integer;
begin
  insert into public.audio_upload_rate_limits as current_limit (
    user_id,
    window_start,
    request_count
  )
  values (p_user_id, current_hour, 1)
  on conflict (user_id) do update
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

revoke all on function public.consume_audio_upload_quota(uuid) from public, anon, authenticated;
grant execute on function public.consume_audio_upload_quota(uuid) to service_role;