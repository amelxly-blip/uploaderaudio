begin;

select plan(10);

select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'first upload is allowed'
);
select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'second upload is allowed'
);
select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'third upload is allowed'
);
select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'fourth upload is allowed'
);
select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'fifth upload is allowed'
);
select ok(
  not public.consume_discord_audio_upload_quota('00000000000000000'),
  'sixth upload is denied'
);
select ok(
  public.consume_discord_audio_upload_quota('00000000000000001'),
  'a different Discord user has an independent quota'
);

update public.discord_audio_upload_rate_limits
set upload_timestamps = array[
  now() - interval '25 hours',
  now() - interval '23 hours',
  now() - interval '12 hours',
  now() - interval '1 hour',
  now()
]
where discord_user_id = '00000000000000000';

select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'an upload is allowed when one previous upload ages past 24 hours'
);
select ok(
  not public.consume_discord_audio_upload_quota('00000000000000000'),
  'the rolling window still denies the sixth recent upload'
);

update public.discord_audio_upload_rate_limits
set upload_timestamps = array_fill(now() - interval '25 hours', array[5])
where discord_user_id = '00000000000000000';

select ok(
  public.consume_discord_audio_upload_quota('00000000000000000'),
  'the quota is available after all previous uploads age past 24 hours'
);

select * from finish();
rollback;
