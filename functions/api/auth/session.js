import {
  clearSessionCookie,
  getDiscordSession,
} from "../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const user = await getDiscordSession(request, env);
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!user && request.headers.has("Cookie")) clearSessionCookie(headers, request);
  return Response.json({ user }, { headers });
}
