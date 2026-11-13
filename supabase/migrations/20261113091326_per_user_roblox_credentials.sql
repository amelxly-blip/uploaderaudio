create table public.discord_roblox_credentials (
  discord_user_id text primary key
    check (discord_user_id ~ '^[0-9]{17,20}$'),
  creator_type text not null
    check (creator_type in ('user', 'group')),
  creator_id text not null
    check (creator_id ~ '^[1-9][0-9]{0,15}$'),
  api_key_ciphertext text not null,
  api_key_nonce text not null
    check (api_key_nonce ~ '^[A-Za-z0-9_-]{16}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.discord_roblox_credentials enable row level security;
revoke all on table public.discord_roblox_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.discord_roblox_credentials to service_role;