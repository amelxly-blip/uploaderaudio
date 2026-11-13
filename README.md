# MCHLERN Audio Workspace

Responsive Indonesian Roblox audio uploader. Cloudflare Pages serves the Vite frontend and handles Discord OAuth in Pages Functions. Supabase Postgres stores per-Discord upload quotas and history; Supabase Edge Functions upload and poll Roblox Open Cloud.

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
2. Set `AUTH_BRIDGE_SECRET` in **Edge Functions → Secrets**. Use a random secret of at least 32 bytes; set the exact same value as a Cloudflare Pages Function secret. Keep this value stable: it also derives the encryption key for users' saved Roblox API keys, so rotating it means each user must save their Roblox API key again.
3. Set `APP_ORIGINS` to the Cloudflare Pages origin, for example `https://uploaderaudio.pages.dev`. Add additional trusted origins as a comma-separated list.
4. Add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, and `SUPABASE_DB_URL` as GitHub Actions repository secrets, then run **Actions → Test and deploy Supabase → Run workflow** once to apply migrations and deploy Edge Functions. Get `SUPABASE_DB_URL` from the project's **Connect → Session pooler** settings; replace `[YOUR-PASSWORD]` with the database password and keep the full URL secret.
Any Discord account that successfully signs in can use the uploader. Each account can submit up to 5 valid audio upload attempts in any
rolling 24-hour period. Supabase stores the quota across logout, restarts, and
deployments; failed Roblox processing attempts still count. Each Discord account
enters its own Roblox Creator ID and Open Cloud API key on the site's Setup page.
The API key is encrypted server-side and is never returned to the browser.
Roblox's creator permissions and upload quota still apply.

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

The GitHub workflow `.github/workflows/supabase-deploy.yml` runs tests and a production build, applies pending migrations, and deploys Edge Functions when Supabase files change on `main`. Users enter their own Roblox credentials on the Setup page; do not configure user API keys in Supabase or Cloudflare.

## Tests

`npm test` runs the mocked audio validation, auth-token, and credential-encryption tests. Tests do not call Discord or Roblox and do not upload assets.
