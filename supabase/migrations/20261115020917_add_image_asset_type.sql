alter table public.audio_uploads
  drop constraint if exists audio_uploads_asset_type_check;

alter table public.audio_uploads
  add constraint audio_uploads_asset_type_check
  check (asset_type in ('Audio', 'Decal', 'Image', 'Model'));