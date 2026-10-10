// /admin/connect/authorize — the consent step of the FIA connector's sign-in
// (Phase 5b). The Claude app sends Todd here; /admin is login-gated, so he
// signs in first if needed, then Allow sends a one-time code back to Claude.

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { parseAuthorize } from "@/lib/mcp/oauth-core";
import { createAuthCode, loadClient, mcpReady } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

function back(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

export default async function AuthorizePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const shell = (body: React.ReactNode) => (
    <section className="container-content py-12 max-w-xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">Ask the business</p>
      {body}
    </section>
  );
  if (!(await mcpReady())) return shell(<p>Run <code>npm run db:migrate</code> first (migration 0040).</p>);
  const p = parseAuthorize(searchParams);
  if ("error" in p) return shell(<p className="text-red-700">Can&apos;t connect: {p.error}</p>);
  const client = await loadClient(p.clientId);
  if (!client || !client.redirectUris.includes(p.redirectUri))
    return shell(<p className="text-red-700">This connection request isn&apos;t recognized. Remove the connector in Claude and add it again.</p>);

  const params = p;
  async function allow() {
    "use server";
    const session = await auth();
    if (!session?.user) throw new Error("Not signed in");
    const code = await createAuthCode({
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      who: session.user.email ?? "admin",
    });
    redirect(back(params.redirectUri, { code, state: params.state }));
  }
  async function deny() {
    "use server";
    redirect(back(params.redirectUri, { error: "access_denied", state: params.state }));
  }

  const host = new URL(p.redirectUri).host;
  return shell(
    <>
      <h1 className="font-marker text-3xl mb-4">Connect {client.name ?? "an assistant"} to FIA?</h1>
      <p className="mb-3">It will be able to <strong>read</strong>:</p>
      <ul className="list-disc pl-5 mb-4 text-sm space-y-1">
        <li>inventory, bins, prices and where things are listed</li>
        <li>sales history by venue, category and bin, and the shake-up report</li>
        <li>the to-ship queue, the books (fees, postage, profit) and hauls</li>
        <li>buyer usernames and city/state — no names, street addresses or emails</li>
        <li>listing drafts and AI spend</li>
      </ul>
      <p className="text-sm text-brand-ink/70 mb-6">
        It can&apos;t change, list, publish or buy anything. You can cut it off any time on{" "}
        <a href="/admin/connect" className="underline">Connections</a>. The approval goes back to <code>{host}</code>.
      </p>
      <div className="flex gap-3">
        <form action={allow}>
          <button className="px-5 py-2 rounded bg-brand-ink text-white font-medium">Allow read-only access</button>
        </form>
        <form action={deny}>
          <button className="px-5 py-2 rounded border border-brand-ink/30">Cancel</button>
        </form>
      </div>
    </>
  );
}
