// /admin/mail/addresses — assign yourself addresses on foundinalabama.com
// and theephemeralstate.com, choose site inbox / forward / both, and see
// Cloudflare's status for each domain and forward-to destination.

import Link from "next/link";
import {
  configuredDomains,
  destinationMap,
  domainStatuses,
  listAddresses,
} from "@/lib/email/addresses";
import { cloudflareConfigured } from "@/lib/email/cloudflare";
import AddressManager from "./AddressManager";

export const dynamic = "force-dynamic";

export default async function MailAddressesPage() {
  const configured = cloudflareConfigured();
  const [addresses, statuses, destinations] = await Promise.all([
    listAddresses(),
    domainStatuses(),
    destinationMap().catch(() => new Map()),
  ]);

  const destinationList = [...destinations.values()].map((d) => ({
    email: d.email.toLowerCase(),
    verified: !!d.verified,
  }));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">Mail</p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">Email addresses</h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Make any address you like on your domains. Each one can land in the{" "}
        <Link href="/admin/mail" className="underline">site inbox</Link>, forward to
        another address, or both. Changes go to Cloudflare Email Routing right
        away; a new forward-to address gets a one-time verification email from
        Cloudflare, and forwarding starts once you click its link.
      </p>

      {!configured && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-8 max-w-2xl text-sm">
          <strong>Not connected to Cloudflare.</strong> Add{" "}
          <code>CLOUDFLARE_API_TOKEN</code> in Vercel → Settings → Environment
          Variables, then redeploy. Addresses can&rsquo;t be created until then.
        </div>
      )}

      <AddressManager
        domains={configuredDomains()}
        defaultForwardTo={process.env.ADMIN_EMAIL ?? ""}
        initialAddresses={addresses.map((a) => ({
          id: a.id,
          address: a.address,
          domain: a.domain,
          mode: a.mode as "inbox" | "forward" | "both",
          forwardTo: a.forwardTo,
          label: a.label,
          enabled: a.enabled,
          syncStatus: a.syncStatus,
          syncError: a.syncError,
        }))}
        destinations={destinationList}
        statuses={statuses}
        canEdit={configured}
      />

      <div className="mt-10">
        <Link href="/admin/mail" className="text-sm text-brand-ink/60 hover:text-brand-ink">
          ← Back to inbox
        </Link>
      </div>
    </section>
  );
}
