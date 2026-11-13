# MCHLERN Audio Workspace

Responsive Indonesian Roblox audio uploader. Cloudflare Pages hosts the static Vite frontend; Supabase Auth handles Discord sign-in, Postgres stores access and upload history under RLS, and Supabase Edge Functions upload and poll Roblox Open Cloud.

The Roblox API key is stored only as a Supabase Edge Function secret. The app does not use Roblox cookies, expose API keys, or bypass Roblox moderation.

## Local frontend

1. Use Node.js 22.12 or newer.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Install and start Vite:

   ```sh
   npm ci
   npm run dev
   ```

4. Configure `http://localhost:5173` in Supabase Auth's allowed redirect URLs.

To run Edge Functions locally, install the Supabase CLI and Docker, start the local Supabase stack, then copy `supabase/functions/.env.example` to `supabase/functions/.env`. See [Supabase local development](https://supabase.com/docs/guides/local-development/cli/getting-started).

## Supabase setup

1. Create a Supabase project and enable Discord under **Authentication → Sign In / Providers**.
2. In Discord Developer Portal, set the OAuth redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Under **Authentication → URL Configuration**, set the Cloudflare Pages URL as Site URL and add the production URL plus `http://localhost:5173` as redirect URLs.
4. Add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` as GitHub Actions repository secrets, then run **Actions → Test and deploy Supabase → Run workflow** once. This applies the migration and deploys the Edge Functions.
5. Sign in once, find your user UUID under **Authentication → Users**, then authorize it in SQL Editor:

   ```sql
   insert into public.authorized_uploaders (user_id)
   values ('YOUR-SUPABASE-AUTH-USER-UUID')
   on conflict (user_id) do nothing;
   ```

   Only add trusted users. The browser cannot grant itself access.
6. Under **Edge Functions → Secrets**, set `APP_ORIGINS` to the production Cloudflare Pages origin (comma-separated if using more than one origin), `ROBLOX_OPEN_CLOUD_API_KEY`, `ROBLOX_CREATOR_TYPE` (`user` or `group`), and `ROBLOX_CREATOR_ID`.
7. Add your Supabase URL and publishable key as Cloudflare Pages build environment variables named `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The publishable key is intended for browser use; RLS still controls database access.

## Cloudflare Pages and automatic deploys

1. Import this GitHub repository into Cloudflare Pages and select the `main` branch.
2. Set build command to `npm ci && npm run build`, output directory to `dist`, and `NODE_VERSION` to `22`.
3. Add the two `VITE_SUPABASE_*` build variables above. Cloudflare Pages then builds frontend changes pushed to `main`.
4. In GitHub repository **Settings → Secrets and variables → Actions → New repository secret**, add:
   - `SUPABASE_ACCESS_TOKEN`: a scoped Supabase access token with database migration and Edge Function deployment permissions.
   - `SUPABASE_PROJECT_ID`: the Supabase project reference.

The workflow `.github/workflows/supabase-deploy.yml` runs tests and a production build, applies pending migrations, and deploys Edge Functions when Supabase files change on `main`. Configure `ROBLOX_OPEN_CLOUD_API_KEY` and the creator settings directly in Supabase, never in GitHub or Cloudflare.

## Tests

Run `npm test` for mocked audio validation tests. Automated tests do not call Roblox or upload assets.
