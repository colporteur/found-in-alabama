// /admin/listings/:id — one listing draft: photos, what intake knew, the
// writer's controls and notes (LIST-2), and the listing fields (editable by
// hand). Nothing on this page publishes.

import Link from "next/link";
import { notFound } from "next/navigation";
import { formatSpecifics, loadDraft } from "@/lib/listings/drafts";
import { DraftEditor } from "./DraftEditor";
import { WriterPanel } from "./WriterPanel";
import { AiNotes } from "./AiNotes";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: { id: string } }) {
  const d = await loadDraft(params.id);
  if (!d) notFound();
  const facts = Object.entries(d.facts).filter(([, v]) => v != null && v !== "");
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
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-2">{d.title ?? d.titleHint ?? "Untitled item"}</h1>
      <p className="text-sm text-brand-ink/60 mb-6">
        {d.sourceLabel ?? d.source} · added {new Date(d.createdAt).toLocaleString("en-US")}
        {d.createdBy && <> by {d.createdBy.replace(/^apikey:/, "")}</>}
      </p>

      <div className="flex gap-3 overflow-x-auto pb-3 mb-8">
        {d.photoList.map((p) => (
          <figure key={p.position} className="shrink-0 w-48">
            <div className="w-48 h-48 bg-brand-ink/5 rounded border border-brand-ink/10 flex items-center justify-center overflow-hidden">
              {p.uploaded ? (
                <a href={p.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="object-contain max-w-full max-h-48" />
                </a>
              ) : (
                <span className="text-xs text-brand-ink/40">not uploaded yet</span>
              )}
            </div>
            <figcaption className="text-xs text-brand-ink/60 mt-1 truncate">
              {p.position}. {p.role ?? ""} {p.name ?? ""}
            </figcaption>
          </figure>
        ))}
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
      />

      {d.aiMeta && <AiNotes meta={d.aiMeta} shippingProfile={d.shippingProfile} venuePrices={d.venuePrices} />}

      <DraftEditor
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
        }}
      />
    </section>
  );
}
