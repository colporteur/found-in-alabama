// /admin/listings — listing drafts. Items sent from the PC ("Send to
// listing" on the Scans page) or started in the manual lister (LIST-1),
// written by the listing writer and reviewed / approved here (LIST-2).
// Nothing here publishes.

import Link from "next/link";
import { draftsReady, listDrafts } from "@/lib/listings/drafts";
import { DraftGrid } from "./DraftGrid";
import { DraftTable } from "./DraftTable";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { loadParentShelves } from "@/lib/listings/bulk";
import { poolSummary } from "@/lib/listings/pool";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading photos",
  ready: "Ready to write",
  generating: "Writing",
  review: "To review",
  approved: "Approved",
  in_nifty: "In Nifty (draft)",
  published: "Published",
  sent_back: "Sent back",
  with_claude: "With Claude",
  pooled: "In lot pool",
  discarded: "Discarded",
};

export default async function ListingsPage({ searchParams }: { searchParams: { status?: string; view?: string } }) {
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
  const table = searchParams.view === "table";
  const { drafts, counts } = await listDrafts(status, table ? 300 : 100);
  const shelves = (await buildCategoryOptions().catch(() => []))
    .map((o) => ({ id: o.id, path: o.path.replace(/&amp;/g, "&") }))
    .sort((a, b) => a.path.localeCompare(b.path));
  // Shelves with subcategories: pick one and FIA's AI picks the subcategory.
  const parents = (await loadParentShelves().catch(() => [])).map((p) => ({ id: p.id, path: p.path }));
  const pool = await poolSummary().catch(() => ({ readyLots: 0, readyNames: [] as string[], candidates: 0 }));
  const href = (v: string | null, st: string | null = status) => {
    const p = new URLSearchParams();
    if (st) p.set("status", st);
    if (v) p.set("view", v);
    const q = p.toString();
    return `/admin/listings${q ? `?${q}` : ""}`;
  };
  const active = Object.entries(counts).filter(([k]) => k !== "discarded").reduce((a, [, v]) => a + v, 0);

  return (
    <section className={table ? "w-full px-4 md:px-6 py-12" : "container-content py-12"}>
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">Inventory</p>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-marker text-4xl md:text-5xl">Listings</h1>
          <p className="text-sm text-brand-ink/60 mt-2">
            Items on their way to becoming listings. Send items from the Scans page on your PC, or start one here.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/listings/pool" className="text-sm px-4 py-2 rounded border border-purple-700 text-purple-900 hover:bg-purple-50">
            Lot pool{counts.pooled ? ` (${counts.pooled})` : ""}
            {pool.readyLots > 0 && (
              <span className="ml-1.5 rounded bg-green-700 text-white text-xs font-bold px-1.5 py-0.5">{pool.readyLots} ready</span>
            )}
          </Link>
          <Link href="/admin/listings/settings" className="text-sm px-4 py-2 rounded border border-brand-ink/20 hover:border-brand-ink/50">
            Writer settings
          </Link>
          <Link
            href="/admin/listings/new"
            className="text-sm px-4 py-2 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80"
          >
            New listing
          </Link>
        </div>
      </div>

      {(pool.readyLots > 0 || status === "pooled") && (
        <Link
          href="/admin/listings/pool"
          className="block mb-6 rounded-lg border-2 border-green-700 bg-green-50 p-3 text-sm hover:bg-green-100"
        >
          {pool.readyLots > 0 ? (
            <>
              <b>
                {pool.readyLots} lot{pool.readyLots === 1 ? "" : "s"} ready to list in the lot pool
              </b>
              : {pool.readyNames.slice(0, 4).join(" · ")}
              {pool.readyNames.length > 4 && ` · +${pool.readyNames.length - 4} more`}.{" "}
            </>
          ) : (
            <b>No lot in the pool is ready yet. </b>
          )}
          {status === "pooled" && "This list shows the single pieces sitting in LOTPOOL; the lots they're grouped into are on the Lot pool page. "}
          <span className="underline font-semibold">Open the Lot pool →</span>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6 text-sm">
        <FilterChip href={href(table ? "table" : null, null)} label={`All (${active})`} on={!status} />
        {Object.keys(STATUS_LABEL).map((k) =>
          counts[k] ? (
            <FilterChip key={k} href={href(table ? "table" : null, k)} label={`${STATUS_LABEL[k]} (${counts[k]})`} on={status === k} />
          ) : null
        )}
        <span className="ml-auto flex gap-3">
          <Link href={href(null)} className={!table ? "font-semibold underline" : "text-brand-ink/60"}>
            Cards
          </Link>
          <Link href={href("table")} className={table ? "font-semibold underline" : "text-brand-ink/60"}>
            Table
          </Link>
        </span>
      </div>

      {table ? (
        <DraftTable key={drafts.map((d) => d.id).join(",")} drafts={drafts} shelves={shelves} parents={parents} />
      ) : (
        <DraftGrid drafts={drafts} readyCount={counts.ready ?? 0} shelves={shelves} parents={parents} />
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
