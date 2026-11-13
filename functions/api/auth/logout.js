import {
  clearSessionCookie,
  sameOriginError,
} from "../../_shared/auth.js";

export async function onRequestPost({ request }) {
  const originError = sameOriginError(request);
  if (originError) return originError;

  const headers = new Headers({ "Cache-Control": "no-store" });
  clearSessionCookie(headers, request);
  return Response.json({ success: true }, { headers });
}
