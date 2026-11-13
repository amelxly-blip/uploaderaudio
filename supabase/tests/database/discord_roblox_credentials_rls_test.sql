begin;

select plan(4);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.discord_roblox_credentials'::regclass),
  'credential table has row level security enabled'
);
select ok(
  not has_table_privilege('anon', 'public.discord_roblox_credentials', 'SELECT')
  and not has_table_privilege('anon', 'public.discord_roblox_credentials', 'INSERT')
  and not has_table_privilege('anon', 'public.discord_roblox_credentials', 'UPDATE')
  and not has_table_privilege('anon', 'public.discord_roblox_credentials', 'DELETE'),
  'anonymous clients cannot access credentials'
);
select ok(
  not has_table_privilege('authenticated', 'public.discord_roblox_credentials', 'SELECT')
  and not has_table_privilege('authenticated', 'public.discord_roblox_credentials', 'INSERT')
  and not has_table_privilege('authenticated', 'public.discord_roblox_credentials', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.discord_roblox_credentials', 'DELETE'),
  'authenticated clients cannot access credentials directly'
);
select ok(
  has_table_privilege('service_role', 'public.discord_roblox_credentials', 'SELECT')
  and has_table_privilege('service_role', 'public.discord_roblox_credentials', 'INSERT')
  and has_table_privilege('service_role', 'public.discord_roblox_credentials', 'UPDATE')
  and has_table_privilege('service_role', 'public.discord_roblox_credentials', 'DELETE'),
  'server-side service role can manage credentials'
);

select * from finish();
rollback;
