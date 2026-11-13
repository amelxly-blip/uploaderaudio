begin;

select plan(16);

create temporary table site_stats_before as
select unique_visitors, successful_uploads
from public.site_global_stats
where id = 1;

select ok(
  public.grant_site_vip('00000000000000101', 7) > now() + interval '6 days',
  'VIP grant returns an expiry about seven days in the future'
);
select is(
  (select count(*)::integer from public.site_vip_entitlements where expires_at > now()),
  1,
  'VIP grant creates one active entitlement'
);
select ok(
  (
    select bool_and(public.consume_discord_audio_upload_quota('00000000000000101'))
    from generate_series(1, 6)
  ),
  'VIP users can exceed the five-upload free quota'
);
select is(
  (
    select pg_catalog.cardinality(upload_timestamps)
    from public.discord_audio_upload_rate_limits
    where discord_user_id = '00000000000000101'
  ),
  null::integer,
  'VIP uploads do not accumulate free quota timestamps'
);

update public.site_vip_entitlements
set expires_at = now() - interval '1 minute'
where discord_user_id = '00000000000000101';
select ok(
  public.consume_discord_audio_upload_quota('00000000000000101'),
  'an expired VIP entitlement falls back to the free quota'
);
select ok(
  public.revoke_site_vip('00000000000000101'),
  'admin can revoke an expired VIP entitlement'
);

select public.record_site_discord_visitor(
  '00000000000000102',
  'visitor',
  'Visitor One',
  ''
);
select public.record_site_discord_visitor(
  '00000000000000102',
  'visitor-updated',
  'Visitor Two',
  ''
);
select is(
  (
    select unique_visitors - before.unique_visitors
    from public.site_global_stats
    cross join site_stats_before as before
    where id = 1
  ),
  1::bigint,
  'unique visitor counter increments once per Discord ID'
);
select is(
  (
    select username
    from public.site_discord_visitors
    where discord_user_id = '00000000000000102'
  ),
  'visitor-updated',
  'visitor profile updates without creating a second visitor'
);

insert into public.audio_uploads (discord_user_id, display_name, file_size, asset_type)
values ('00000000000000104', 'Counter test', 1, 'Model')
returning id \gset
update public.audio_uploads
set status = 'completed', asset_id = '900001'
where id = :'id';
update public.audio_uploads
set asset_id = '900001'
where id = :'id';
select is(
  (
    select successful_uploads - before.successful_uploads
    from public.site_global_stats
    cross join site_stats_before as before
    where id = 1
  ),
  1::bigint,
  'completed model upload increments the global counter only once'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.site_global_stats'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.site_discord_visitors'::regclass),
  'public statistics and visitor tables have row level security enabled'
);
select ok(
  not has_table_privilege('anon', 'public.site_vip_entitlements', 'SELECT')
  and not has_table_privilege('authenticated', 'public.site_user_bans', 'SELECT')
  and not has_table_privilege('anon', 'public.site_admin_login_limits', 'SELECT'),
  'client roles cannot read VIP, ban, or login limit records'
);
select ok(
  not has_function_privilege('anon', 'public.grant_site_vip(text,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.grant_site_vip(text,integer)', 'EXECUTE'),
  'only the server service role can grant VIP'
);
select ok(
  (
    select bool_and(public.consume_site_admin_login_attempt(repeat('a', 64)))
    from generate_series(1, 5)
  ),
  'five admin login attempts are allowed per IP hash'
);
select ok(
  not public.consume_site_admin_login_attempt(repeat('a', 64)),
  'the sixth admin login attempt is rate limited'
);
update public.site_admin_login_limits
set attempts = array[now() - interval '16 minutes']
where address_hash = repeat('a', 64);
select ok(
  public.consume_site_admin_login_attempt(repeat('a', 64)),
  'admin login attempts are accepted again after the rate window'
);
select public.reset_site_admin_login_attempts(repeat('a', 64));
select ok(
  (select (public.get_site_dashboard(
    '00000000000000103',
    'new-visitor',
    'New Visitor',
    ''
  ) ->> 'quotaRemaining')::integer = 5),
  'dashboard reports the five-upload free quota for a new visitor'
);

select * from finish();
rollback;
