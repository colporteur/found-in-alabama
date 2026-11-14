// /admin/listings/lot-builder — Lot Builder sessions: big batches of one item
// type that Todd already knows are lot material, being sorted into smaller
// lots (lib/listings/lot-build.ts). Sessions start from the Scans page.

import Link from "next/link";
import { listBuilds, lotBuildReady } from "@/lib/listings/lot-build";

export const dynamic = "force-dynamic";

export default async function LotBuilderPage({ searchParams }: { searchParams: { all?: string } }) {
  if (!(await lotBuildReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Lot Builder</h1>
        <p className="text-brand-ink/80">
          The Lot Builder tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>).
        </p>
      </section>
    );
  }
  const all = searchParams.all === "1";
  const builds = await listBuilds(all);
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Lot Builder</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-3xl">
        For a big batch of one kind of thing you already know is lot material. Send a folder from the Scans page (&ldquo;Send to Lot
        Builder&rdquo;, one photo per piece); Claude identifies every piece, flags the ones to <b>pull</b> and sell alone or that{" "}
        <b>need another photo</b>, and proposes lots from the Expert Guide. You adjust and build; the lots then go through Claude and Review
        like any listing.
      </p>
      {builds.length === 0 ? (
        <p className="text-brand-ink/70">No {all ? "" : "open "}sessions.</p>
      ) : (
        <ul className="space-y-3 max-w-3xl">
          {builds.map((b) => (
            <li key={b.id}>
              <Link href={`/admin/listings/lot-builder/${b.id}`} className="block rounded border border-brand-ink/15 bg-white p-4 hover:border-brand-ink/50">
                <span className="font-medium text-lg">{b.name}</span>
                {b.kind && <span className="ml-2 text-sm text-brand-ink/60">{b.kind}</span>}
                {b.status !== "open" && <span className="ml-2 rounded bg-brand-ink/10 px-1.5 py-0.5 text-xs">closed</span>}
                <span className="mt-1 block text-sm text-brand-ink/70">
                  {b.pieces} pieces · {b.sorting} still sorting · {b.lots} lot{b.lots === 1 ? "" : "s"} proposed · {b.built} built
                  {b.createdAt ? ` · started ${b.createdAt.slice(0, 10)}` : ""}
                </span>
                <span className="mt-1 flex flex-wrap gap-2 text-xs">
                  {b.pulls > 0 && <span className="rounded bg-red-700 px-1.5 py-0.5 font-bold text-white">{b.pulls} to pull</span>}
                  {b.needPhoto > 0 && <span className="rounded bg-amber-600 px-1.5 py-0.5 font-bold text-white">{b.needPhoto} need a photo</span>}
                  {b.needsLook > 0 && <span className="rounded bg-sky-700 px-1.5 py-0.5 text-white">{b.needsLook} waiting for Claude</span>}
                  {b.unplaced > 0 && <span className="rounded bg-brand-ink/10 px-1.5 py-0.5">{b.unplaced} not in a lot</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-sm">
        <Link href={all ? "/admin/listings/lot-builder" : "/admin/listings/lot-builder?all=1"} className="underline">
          {all ? "Open sessions only" : "Show closed sessions too"}
        </Link>
      </p>
    </section>
  );
}
