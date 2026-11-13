alter table public.audio_uploads
  add column asset_type text not null default 'Audio'
    check (asset_type in ('Audio', 'Decal', 'Model'));