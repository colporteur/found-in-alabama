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
import { FolderLotPanel } from "./FolderLotPanel";
import { folderLotOf } from "@/lib/listings/folder-lot";
import { photoFitOf } from "@/lib/listings/photo-fit";
import { AddToPool } from "../pool/AddToPool";
import { AddToOpenLot } from "./AddToOpenLot";
import { openLots } from "@/lib/listings/open-lots";
import { poolReady } from "@/lib/listings/pool";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { MarkListed } from "./MarkListed";
import { FixPanel } from "./FixPanel";
import { FIXABLE, fixesForDraft } from "@/lib/listings/fixes";
import { EbayPublishPanel } from "./EbayPublishPanel";
import { draftCardCondition } from "@/lib/ebay/publish";
import { draftRoute, ebaySettings } from "@/lib/ebay/publish-settings";
import { isCardSingle } from "@/lib/ebay/publish-core";
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
  const fixes = await fixesForDraft(d.id).catch(() => []);
  const ebayDone = (d.aiMeta?.ebayPublish as { itemId?: string } | undefined)?.itemId ?? null;
  // Straight to eBay: the pilot panel on approved drafts, and always for
  // single trading cards (review/approved, or sent to Nifty and stuck there).
  const ebayS = await ebaySettings().catch(() => ({ enabled: false, cardsDirect: true }));
  const isCard = isCardSingle(d.ebayCategoryId);
  const route = draftRoute(ebayS, d.ebayCategoryId, d.aiMeta);
  const ebayPilot =
    (d.status === "approved" && !d.niftyItemId && (ebayS.enabled || route === "ebay")) ||
    (isCard && (d.status === "review" || d.status === "approved" || d.status === "in_nifty"));
  const cardCondition = isCard
    ? draftCardCondition({ condition: d.condition ?? "Used", conditionNote: d.conditionNote, itemSpecifics: d.itemSpecifics ?? {}, aiMeta: d.aiMeta ?? {} })
    : null;
  // Lot pool: forming lots for "Send to lot pool", and whether this draft is in it.
  const pool = (await poolReady().catch(() => false))
    ? {
        groups: (((await db.execute(sql`SELECT id, name FROM lot_groups WHERE status = 'forming' ORDER BY name`)) as { rows?: Array<{ id: string; name: string }> }).rows ?? []).map((g) => ({ id: String(g.id), name: String(g.name) })),
      }
    : null;
  const openLotList = await openLots().catch(() => []);
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
        const lot = d.aiMeta?.lot as
          | {
              parts?: Array<{ draftId: string; title: string | null; bin: string | null; candidate?: { registryItemId: string } }>;
              reason?: string | null;
              poolGroupId?: string;
              additions?: Array<{ at: string; pieces: string[]; reason: string | null }>;
            }
          | undefined;
        const since = (d.aiMeta?.lotOpen as { since?: string } | undefined)?.since ?? null;
        return lot?.parts?.length ? (
          <LotPanel
            id={d.id}
            parts={lot.parts}
            reason={lot.reason ?? null}
            fromPool={!!lot.poolGroupId}
            canSplit={["ready", "review", "sent_back", "with_claude", "lot_open"].includes(d.status)}
            canOpen={["ready", "review", "sent_back", "with_claude"].includes(d.status)}
            open={d.status === "lot_open" ? { since, days: since ? Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000) : 0 } : null}
            additions={lot.additions ?? []}
            fit={(() => {
              const f = photoFitOf(d.aiMeta);
              return { soloOnly: f.soloOnly === true, text: f.text ?? "", dropped: f.dropped ?? [], error: f.error ?? null };
            })()}
            canFit={ROTATABLE.includes(d.status)}
          />
        ) : null;
      })()}
      {(() => {
        const f = folderLotOf(d.aiMeta);
        const pending = d.aiMeta?.folderLotPending === true;
        const error = typeof d.aiMeta?.folderLotError === "string" ? (d.aiMeta.folderLotError as string) : null;
        return f || pending || error ? (
          <FolderLotPanel
            id={d.id}
            pieces={f?.pieces.length ?? 0}
            picked={f?.picked ?? []}
            text={f?.text ?? ""}
            dropped={f?.dropped ?? []}
            soloOnly={photoFitOf(d.aiMeta).soloOnly === true}
            error={error}
            pending={pending}
            canEdit={ROTATABLE.includes(d.status)}
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
        {pool && ["ready", "review", "sent_back", "with_claude"].includes(d.status) && !d.aiMeta?.lot && !d.aiMeta?.folderLot && <AddToPool draftId={d.id} groups={pool.groups} />}
        {openLotList.length > 0 && ["ready", "review", "sent_back", "with_claude"].includes(d.status) && !d.aiMeta?.lot && !d.aiMeta?.folderLot && (
          <AddToOpenLot draftId={d.id} lots={openLotList.map((l) => ({ id: l.id, title: l.title, pieces: l.pieces.length }))} />
        )}
        {d.status === "pooled" && (
          <Link href="/admin/listings/pool" className="text-sm px-3 py-2 rounded border border-purple-700 text-purple-900 hover:bg-purple-50">
            In the lot pool (bin LOTPOOL) — open the Lot pool
          </Link>
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

      <FixPanel id={d.id} fixes={fixes} canAsk={FIXABLE.includes(d.status) && !!d.title} />

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
          status={d.status}
          route={route}
          canChooseRoute={ebayS.enabled || isCard}
          card={cardCondition}
          cardChosen={!!d.aiMeta?.cardCondition}
        />
      )}

      {d.status === "published" && ebayDone && (
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
