// /admin/listings/:id — one listing draft: photos, what intake knew, the
// writer's controls and notes (LIST-2), and the listing fields (editable by
// hand). Nothing on this page publishes.

import Link from "next/link";
import { notFound } from "next/navigation";
import { formatSpecifics, loadDraft, nextReviewId } from "@/lib/listings/drafts";
import { DraftEditor } from "./DraftEditor";
import { WriterPanel } from "./WriterPanel";
import { ResearchPanel } from "./ResearchPanel";
import type { Research } from "@/lib/listings/research";
import { AiNotes } from "./AiNotes";
import { UnverifiedPanel } from "./UnverifiedPanel";
import { PhotoStrip } from "./PhotoStrip";
import { LotPanel } from "./LotPanel";
import { MarkListed } from "./MarkListed";
import { EbayPublishPanel } from "./EbayPublishPanel";
import { ebayPublishEnabled } from "@/lib/ebay/publish";
import { ROTATABLE } from "@/lib/listings/photos";
import { buildCategoryOptions } from "@/lib/ebay/auto-categorize";
import { booksReady, itemCost, listAcquisitions } from "@/lib/books/books";
import { HaulCostPanel } from "../../books/BooksControls";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: { id: string } }) {
  const d = await loadDraft(params.id);
  if (!d) notFound();
  const facts = Object.entries(d.facts).filter(([, v]) => v != null && v !== "");
  const storeOptions = (await buildCategoryOptions().catch(() => []))
    .map((o) => ({ id: o.id, path: o.path.replace(/&amp;/g, "&") }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const books = d.registryItemId && (await booksReady().catch(() => false))
    ? { cost: await itemCost(d.registryItemId), hauls: await listAcquisitions(100) }
    : null;
  const next = await nextReviewId(d.id).catch(() => ({ id: null, left: 0 }));
  const ebayDone = (d.aiMeta?.ebayPublish as { itemId?: string } | undefined)?.itemId ?? null;
  const ebayPilot = d.status === "approved" && !d.niftyItemId && (await ebayPublishEnabled().catch(() => false));
  const stale =
    d.status === "generating" &&
    (!d.generationStartedAt || Date.now() - new Date(d.generationStartedAt).getTime() > 10 * 60 * 1000);

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>{" "}
        · {d.status.replace("_", " ")}
        {next.id && (
          <Link href={`/admin/listings/${next.id}`} className="ml-4 normal-case tracking-normal underline">
            Next to review → ({next.left} waiting)
          </Link>
        )}
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-2">{d.title ?? d.titleHint ?? "Untitled item"}</h1>
      <p className="text-sm text-brand-ink/60 mb-6">
        {d.sourceLabel ?? d.source} · added {new Date(d.createdAt).toLocaleString("en-US")}
        {d.createdBy && <> by {d.createdBy.replace(/^apikey:/, "")}</>}
      </p>

      {(() => {
        const lot = d.aiMeta?.lot as { parts?: Array<{ draftId: string; title: string | null; bin: string | null }>; reason?: string | null } | undefined;
        return lot?.parts?.length ? (
          <LotPanel
            id={d.id}
            parts={lot.parts}
            reason={lot.reason ?? null}
            canSplit={["ready", "review", "sent_back", "with_claude"].includes(d.status)}
          />
        ) : null;
      })()}
      {typeof d.aiMeta?.combinedInto === "string" && d.status === "discarded" && (
        <p className="mb-6 rounded border border-purple-700 bg-purple-50 p-3 text-sm text-purple-900">
          Claude combined this draft into a lot.{" "}
          <Link href={`/admin/listings/${d.aiMeta.combinedInto as string}`} className="underline font-medium">
            Open the lot
          </Link>{" "}
          (split it there to bring this one back).
        </p>
      )}

      <PhotoStrip id={d.id} photos={d.photoList} canRotate={ROTATABLE.includes(d.status)} />

      <div className="flex flex-wrap items-start gap-4 mb-8">
        {books?.cost && d.registryItemId && (
          <HaulCostPanel
            registryItemId={d.registryItemId}
            hauls={books.hauls.map((h) => ({ id: h.id, name: h.name, acquiredOn: h.acquiredOn }))}
            acquisitionId={books.cost.acquisitionId}
            unitCost={books.cost.unitCost}
            splitCost={books.cost.splitCost}
          />
        )}
        <a
          href={`/admin/labels/print?k=d:${d.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-sm px-3 py-2 rounded border border-brand-ink/20 hover:border-brand-ink/50"
        >
          Print inventory label
        </a>
      </div>

      {facts.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-2">What intake knew</h2>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-brand-ink/60">{k}</dt>
                <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <WriterPanel
        id={d.id}
        status={d.status}
        writtenBy={d.writtenBy}
        reviewNote={d.reviewNote}
        generationError={d.generationError}
        stale={stale}
        handMode={d.facts.mode === "hand"}
        nextId={next.id}
      />

      <ResearchPanel key={String((d.aiMeta?.research as Research | undefined)?.at ?? "none")} id={d.id} status={d.status} research={(d.aiMeta?.research as Research | null | undefined) ?? null} />

      {ebayPilot && (
        <EbayPublishPanel
          id={d.id}
          initial={(d.aiMeta?.ebayCheck as Parameters<typeof EbayPublishPanel>[0]["initial"]) ?? null}
        />
      )}

      {d.status === "published" && !d.niftyItemId && ebayDone && (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8 text-sm">
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-1">eBay</h2>
          <p>
            Published straight to eBay from FIA:{" "}
            <a
              className="underline"
              href={`https://www.ebay.com/itm/${ebayDone}`}
              target="_blank"
              rel="noreferrer"
            >
              {ebayDone}
            </a>
            . To crosslist, import it into Nifty from eBay.
          </p>
        </div>
      )}

      {(d.niftyItemId || d.niftyError) && (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8 text-sm space-y-1">
          <h2 className="text-xs uppercase tracking-wider text-brand-earth mb-1">Nifty</h2>
          {d.niftyItemId && (
            <p>
              Saved as a Nifty draft{d.niftySentAt && <> on {new Date(d.niftySentAt).toLocaleString("en-US")}</>}:{" "}
              <a className="underline" href={`https://app.nifty.ai/inventory/edit/${d.niftyItemId}`} target="_blank" rel="noreferrer">
                open in Nifty
              </a>
              . Review it and publish from Nifty.
            </p>
          )}
          {d.niftyError && <p className="text-red-800">Last send failed: {d.niftyError}</p>}
          {d.status === "published" && (
            <p>
              Published
              {typeof d.aiMeta?.ebayItemId === "string" && (
                <>
                  {" "}— eBay{" "}
                  <a className="underline" href={`https://www.ebay.com/itm/${d.aiMeta.ebayItemId}`} target="_blank" rel="noreferrer">
                    {d.aiMeta.ebayItemId}
                  </a>
                </>
              )}
              .
            </p>
          )}
          {d.status === "in_nifty" && <MarkListed id={d.id} />}
          {d.niftyWarnings.length > 0 && (
            <ul className="text-xs list-disc pl-4 text-brand-ink/70">
              {d.niftyWarnings.map((w, k) => (
                <li key={k}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {Array.isArray(d.aiMeta?.unverified) && (
        <UnverifiedPanel
          id={d.id}
          items={d.aiMeta.unverified as Array<{ words: string; basis?: string; decision?: string | null }>}
          editable={["review", "sent_back", "ready"].includes(d.status)}
        />
      )}
      {d.aiMeta && <AiNotes meta={d.aiMeta} shippingProfile={d.shippingProfile} venuePrices={d.venuePrices} />}

      <DraftEditor
        key={d.updatedAt}
        storeOptions={storeOptions}
        assumedWeight={(() => {
          const w = d.aiMeta?.weight as { oz?: number | null; reason?: string; source?: string } | undefined;
          return w && w.source !== "given" ? { oz: w.oz ?? null, reason: String(w.reason ?? "") } : null;
        })()}
        id={d.id}
        status={d.status}
        initial={{
          title: d.title ?? "",
          description: d.description ?? "",
          condition: d.condition ?? "",
          conditionNote: d.conditionNote ?? "",
          ebayCategoryId: d.ebayCategoryId ?? "",
          ebayCategoryName: d.ebayCategoryName ?? "",
          itemSpecifics: formatSpecifics(d.itemSpecifics),
          price: d.price != null ? String(d.price) : "",
          binSku: d.binSku ?? "",
          weightOz: d.weightOz != null ? String(d.weightOz) : "",
          quantity: String(d.quantity),
          notes: d.notes ?? "",
          shippingProfile: d.shippingProfile ?? "",
          poshmarkPrice: d.venuePrices?.poshmark != null ? String(d.venuePrices.poshmark) : "",
          storeCategory1: d.storeCategoryIds[0] ?? "",
          storeCategory2: d.storeCategoryIds[1] ?? "",
        }}
      />
    </section>
  );
}
