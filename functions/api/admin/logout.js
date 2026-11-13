import {
  clearAdminSessionCookie,
  sameOriginError,
} from "../../_shared/auth.js";

export async function onRequestPost({ request }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const headers = new Headers({ "Cache-Control": "no-store" });
  clearAdminSessionCookie(headers, request);
  return Response.json({ authenticated: false }, { headers });
}
