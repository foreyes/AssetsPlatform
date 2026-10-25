/* Read-only identity diagnostics for the official private Sites adapter.
 * Deployment must preserve audience enforcement and strip spoofed headers.
 * This route reports adapter configuration, never a hosted security-test result.
 */
import { getChatGPTUser } from '@/app/chatgpt-auth';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  if (new URL(request.url).search) return Response.json({ error: 'query-not-supported' }, { status: 400, headers });
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'sign-in-required', uploadEnabled: false }, { status: 401, headers });
  // Display only this request's identity. No cookie/token capture or first-user-wins.
  // A returned ID alone does not prove that dispatch strips hostile client headers.
  return Response.json({ siteUserId: user.userId, email: user.email,
    uploadEnabled: false, identityAdapter: 'sites-private-ingress-v1',
    identityVerification: 'trusted-ingress-assertion', hostedIngressTest: 'not-established-by-this-route' }, { headers });
}
