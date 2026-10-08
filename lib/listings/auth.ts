// Who is calling a listings API: the PC sender (Bearer API key from
// /admin/api-keys) or Todd signed in to the admin. Returns null if neither.

import { auth } from "@/auth";
import { bearerFromRequest, verifyApiKey } from "@/lib/api-keys";

export async function listingCaller(req: Request): Promise<string | null> {
  const bearer = bearerFromRequest(req);
  if (bearer) {
    const key = await verifyApiKey(bearer);
    return key ? `apikey:${key.name}` : null;
  }
  const session = await auth();
  return session?.user ? session.user.email ?? "admin" : null;
}
