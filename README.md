# MCHLERN Audio Workspace

Responsive Indonesian audio uploader for Roblox Open Cloud. The Discord OAuth flow and Roblox API key stay on the server; Roblox uploads are sent only after the user reviews the file and confirms their rights to use it.

## Run locally

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Create a Discord OAuth2 application and add the exact callback URL `http://localhost:3000/auth/callback` to its Redirects. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` in `.env`.
4. Add the Discord user IDs that may upload to `DISCORD_ALLOWED_USER_IDS` (comma-separated). Leave it empty to deny uploads to everyone.
5. Create a least-privilege Roblox Open Cloud API key with the required Assets permissions. Set `ROBLOX_OPEN_CLOUD_API_KEY`, `ROBLOX_CREATOR_TYPE` (`user` or `group`), and the matching `ROBLOX_CREATOR_ID` in `.env`.
6. Install and start the app:

   ```sh
   npm install
   npm start
   ```

7. Open `http://localhost:3000` and sign in with an allowlisted Discord account.

For production, use HTTPS, set `NODE_ENV=production`, configure `PUBLIC_ORIGIN` and the matching Discord callback URI, and use the host's secret manager instead of committing `.env`.

The server validates audio signatures and duration, limits uploads to 20 MB and 7 minutes, and polls Roblox's official operation endpoint before showing an asset ID. It does not use Roblox cookies, expose API keys, bypass moderation, or retry failed uploads.

Run the mocked tests with `npm test`. Tests do not call Roblox or require real credentials.
