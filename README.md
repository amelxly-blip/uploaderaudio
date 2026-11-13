# MCHLERN Audio Workspace

Responsive Indonesian Roblox audio uploader. Cloudflare Pages serves the Vite frontend and handles Discord OAuth in Pages Functions. Supabase Postgres stores the Discord allowlist and upload history; Supabase Edge Functions upload and poll Roblox Open Cloud.

The Discord session and Roblox API key stay server-side. The app does not use Roblox cookies, expose API keys, or bypass Roblox moderation.

## Local checks

Use Node.js 22.12 or newer:

```sh
npm ci
npm test
npm run build
```

The Vite development server only serves the frontend. The `/api/*` authentication and proxy routes run as Cloudflare Pages Functions.

## Supabase setup

1. Create a Supabase project. Discord sign-in does **not** need to be enabled in Supabase Auth.
2. Set `AUTH_BRIDGE_SECRET` in **Edge Functions → Secrets**. Use a random secret of at least 32 bytes; set the exact same value as a Cloudflare Pages Function secret.
3. Set `APP_ORIGINS` to the Cloudflare Pages origin, for example `https://uploaderaudio.pages.dev`. Add additional trusted origins as a comma-separated list.
4. Set `ROBLOX_OPEN_CLOUD_API_KEY`, `ROBLOX_CREATOR_TYPE` (`user` or `group`), and `ROBLOX_CREATOR_ID` in Edge Function secrets.
5. Add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_URL` as GitHub Actions repository secrets, then run **Actions → Test and deploy Supabase → Run workflow** once to apply migrations and deploy Edge Functions. Get `SUPABASE_DB_URL` from the project's **Connect → Session pooler** settings; replace `[YOUR-PASSWORD]` with the database password and keep the full URL secret.
6. To allow an uploader, enable Developer Mode in Discord, copy their Discord user ID, then run this in Supabase SQL Editor:

   ```sql
   insert into public.authorized_discord_uploaders (discord_user_id)
   values ('DISCORD_USER_ID')
   on conflict (discord_user_id) do nothing;
   ```

   Only add trusted Discord accounts. Login alone does not grant upload access.

## Cloudflare Pages and Discord

1. Import this GitHub repository into Cloudflare Pages and select the `main` branch.
2. Set build command to `npm ci && npm run build`, output directory to `dist`, and `NODE_VERSION` to `22`.
3. Configure these production **Variables** for Pages Functions:
   - `SUPABASE_URL`: `https://<project-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY`: the project's publishable key
   - `DISCORD_CLIENT_ID`: the Discord application's client ID
   - `DISCORD_REDIRECT_URI`: `https://<your-pages-domain>/api/auth/discord/callback`
4. Configure these production **Secrets** for Pages Functions:
   - `DISCORD_CLIENT_SECRET`: the Discord application's client secret
   - `DISCORD_SESSION_SECRET`: a random secret of at least 32 bytes
   - `AUTH_BRIDGE_SECRET`: a separate random secret of at least 32 bytes; set the same value in Supabase Edge Function secrets
5. In Discord Developer Portal, register the exact `DISCORD_REDIRECT_URI` above as an OAuth2 redirect URL. The callback must match the Pages domain and path exactly.
6. Keep OAuth secrets out of Vite build variables, `.env`, GitHub, and source control. Preview deployments need their own matching callback URL and Discord OAuth redirect registration if you want to test login there.

After changing Pages variables or secrets, trigger a new production deployment from `main` so Pages Functions receive the updated values.

The GitHub workflow `.github/workflows/supabase-deploy.yml` runs tests and a production build, applies pending migrations, and deploys Edge Functions when Supabase files change on `main`. Configure the Roblox API key only in Supabase and Discord/session secrets only in Cloudflare.

## Tests

`npm test` runs the mocked audio validation and auth-token tests. Tests do not call Discord or Roblox and do not upload assets.
