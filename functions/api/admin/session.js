import {
  clearAdminSessionCookie,
  getAdminSession,
  hasStrongSecret,
} from "../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const configured = hasStrongSecret(env.ADMIN_PANEL_PASSWORD);
  const authenticated = configured && await getAdminSession(request, env);
  if (!authenticated && request.headers.has("Cookie")) clearAdminSessionCookie(headers, request);
  return Response.json({ configured, authenticated }, { headers });
}
