// /admin/connect — "Ask the business" (Phase 5b): how to add the read-only
// FIA connector to the Claude app, and the list of approved connections
// with a Disconnect button for each.

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { listConnections, mcpReady, revokeGrant } from "@/lib/mcp/oauth";
import { TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";

const fmt = (v: string | null) =>
  v ? new Date(v.endsWith("Z") || v.includes("+") ? v : `${v}Z`).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) : "never";

export default async function ConnectPage() {
  const ready = await mcpReady();
  const list = ready ? await listConnections() : [];

  async function disconnect(form: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user) throw new Error("Not signed in");
    const id = String(form.get("grantId") ?? "");
    if (/^[0-9a-f-]{36}$/i.test(id)) await revokeGrant(id);
    revalidatePath("/admin/connect");
  }

  return (
    <section className="container-content py-12 max-w-3xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">Ask the business</p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">Claude connector</h1>
      <p className="text-brand-ink/70 mb-6 max-w-prose">
        Lets Claude (web, desktop or phone) answer questions from FIA&apos;s data — &ldquo;what sold best on Poshmark
        this summer?&rdquo;, &ldquo;what&apos;s in bin LT225?&rdquo;, &ldquo;which bins haven&apos;t sold anything in 90
        days?&rdquo;. Read-only; buyers appear only as usernames and city/state.
      </p>

      {!ready && <p className="mb-6 text-red-700">Run <code>npm run db:migrate</code> first (migration 0040).</p>}

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Add it to Claude (once)</h2>
      <ol className="list-decimal pl-5 text-sm space-y-1 mb-8">
        <li>In Claude, open Settings → Connectors → Add custom connector.</li>
        <li>
          Name it <strong>FIA</strong>, URL <code className="bg-brand-ink/5 px-1">https://www.foundinalabama.com/api/mcp</code>, leave
          the advanced settings empty, and Add.
        </li>
        <li>Click Connect. You land on an FIA page (sign in if asked) — click <strong>Allow read-only access</strong>.</li>
        <li>In a chat, turn FIA on from the tools menu and ask away.</li>
      </ol>

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">Connections</h2>
      {list.length === 0 ? (
        <p className="text-sm text-brand-ink/60 mb-8">None yet.</p>
      ) : (
        <table className="w-full text-sm mb-8">
          <thead>
            <tr className="text-left text-brand-ink/60">
              <th className="py-1">App</th>
              <th>Approved</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.grantId} className="border-t border-brand-ink/10">
                <td className="py-2">{c.clientName ?? "(unnamed)"}</td>
                <td>{fmt(c.approvedAt)}</td>
                <td>{fmt(c.lastUsedAt)}</td>
                <td className="text-right">
                  {c.active ? (
                    <form action={disconnect}>
                      <input type="hidden" name="grantId" value={c.grantId} />
                      <button className="px-3 py-1 rounded border border-red-300 text-red-800">Disconnect</button>
                    </form>
                  ) : (
                    <span className="text-brand-ink/50">disconnected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">What it can look up</h2>
      <ul className="text-sm space-y-2">
        {TOOLS.map((t) => (
          <li key={t.name}>
            <strong>{t.title}</strong> — <span className="text-brand-ink/70">{t.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
