// /admin/listings/new — the manual lister (Phase LIST-1). Works from the PC
// or the phone: add photos, say what you know, then either let the writer
// fill it in (LIST-2) or write it yourself on the next page.

import Link from "next/link";
import { NewListingForm } from "./NewListingForm";

export const dynamic = "force-dynamic";

export default function NewListingPage() {
  return (
    <section className="container-content py-12 max-w-4xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>
      </p>
      <h1 className="font-marker text-4xl mb-2">New listing</h1>
      <p className="text-sm text-brand-ink/60 mb-8">
        Photos are resized to at most 3,200 pixels on the long side before upload; your originals aren&apos;t changed.
      </p>
      <NewListingForm />
    </section>
  );
}
