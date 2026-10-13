// /admin/listings/pool — the lot pool: lots being formed (pieces, estimated
// values, how long they've waited), pieces not in a lot yet, and the ones to
// put in the physical LOTPOOL bin. "List this lot now" builds the lot draft
// and queues it for Claude; it then goes through Review as usual.

import Link from "next/link";
import { loadPool, poolReady } from "@/lib/listings/pool";
import { PoolBoard } from "./PoolBoard";

export const dynamic = "force-dynamic";

export default async function PoolPage() {
  if (!(await poolReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Lot pool</h1>
        <p className="text-brand-ink/80">
          The lot pool tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>).
        </p>
      </section>
    );
  }
  const pool = await loadPool();
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Lot pool</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-3xl">
        Pieces waiting to become lots. <b>Pooled</b> pieces sit in the <span className="font-mono">LOTPOOL</span> bin and aren&apos;t for sale;{" "}
        <b>candidates</b> are still listed on their own and must be delisted on every marketplace (by hand, for now) before their lot is listed.
        Postcards stay with postcards unless a lot allows mixing. Add pieces from a draft&apos;s page (&ldquo;Send to lot pool&rdquo;), an inventory
        item&apos;s page (&ldquo;Suggest for a lot&rdquo;), or let Claude park them when you send with lots on.
      </p>
      <PoolBoard pool={pool} />
    </section>
  );
}
