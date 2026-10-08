// /admin/listings — listing drafts (Phase LIST-1). Items sent from the PC
// ("Send to listing" on the Scans page) or started in the manual lister.
// The writer and review/approve steps arrive in LIST-2; for now drafts can
// be opened, filled in by hand, or discarded. Nothing here publishes.

import Link from "next/link";
import { draftsReady, listDrafts } from "@/lib/listings/drafts";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading photos",
  ready: "Ready to write",
  generating: "Writing",
  review: "To review",
  approved: "Approved",
  published: "Published",
  sent_back: "Sent back",
  discarded: "Discarded",
};

const SOURCE_LABEL: Record<string, string> = {
  scans: "Scans",
  scanroom: "Scanroom",
  photoxfer: "PhotoXfer",
  estate: "Estate Sorter",
  manual: "Manual",
};

export default async function ListingsPage({ searchParams }: { searchParams: { status?: string } }) {
  if (!(await draftsReady())) {
    return (
      <section className="container-content py-12 max-w-3xl">
        <h1 className="font-marker text-4xl mb-4">Listings</h1>
        <p className="text-brand-ink/80">
          The listing tables don&apos;t exist yet. Run the migration (<code>npm run db:migrate</code>).
        </p>
      </section>
    );
  }
  const status = searchParams.status && STATUS_LABEL[searchParams.status] ? searchParams.status : null;
  const { drafts, counts } = await listDrafts(status);
  const active = Object.entries(counts).filter(([k]) => k !== "discarded").reduce((a, [, v]) => a + v, 0);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">Listings</h1>
          <p className="text-sm text-brand-ink/60 mt-2">
            Items on their way to becoming listings. Send items from the Scans page on your PC, or start one here.
          </p>
        </div>
        <Link
          href="/admin/listings/new"
          className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80"
        >
          New listing
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 text-sm">
        <FilterChip href="/admin/listings" label={`All (${active})`} on={!status} />
        {Object.keys(STATUS_LABEL).map((k) =>
          counts[k] ? (
            <FilterChip key={k} href={`/admin/listings?status=${k}`} label={`${STATUS_LABEL[k]} (${counts[k]})`} on={status === k} />
          ) : null
        )}
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-brand-ink/60">Nothing here yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {drafts.map((d) => (
            <Link
              key={d.id}
              href={`/admin/listings/${d.id}`}
              className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden hover:border-brand-ink/40"
            >
              <div className="aspect-square bg-brand-ink/5 flex items-center justify-center overflow-hidden">
                {d.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.cover} alt="" className="object-contain w-full h-full" />
                ) : (
                  <span className="text-xs text-brand-ink/40">{d.photos} photo{d.photos === 1 ? "" : "s"}</span>
                )}
              </div>
              <div className="p-3 text-sm">
                <p className="font-medium line-clamp-2">{d.title ?? d.titleHint ?? "Untitled item"}</p>
                <p className="text-xs text-brand-ink/60 mt-1">
                  {STATUS_LABEL[d.status] ?? d.status} · {SOURCE_LABEL[d.source] ?? d.source}
                  {d.binSku && <> · bin {d.binSku}</>}
                  {d.price != null && <> · ${d.price.toFixed(2)}</>}
                </p>
                {d.sourceLabel && <p className="text-xs text-brand-ink/40 mt-1 truncate">{d.sourceLabel}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterChip({ href, label, on }: { href: string; label: string; on: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-full border ${on ? "bg-brand-ink text-white border-brand-ink" : "border-brand-ink/20 hover:border-brand-ink/50"}`}
    >
      {label}
    </Link>
  );
}
