// /admin/books/settings — the fee rates used where FIA doesn't have the real
// fee (everything except eBay orders). Venues change these; keep them current.

import Link from "next/link";
import { booksReady, booksSettings } from "@/lib/books/books";
import { FeeForm } from "../BooksControls";

export const dynamic = "force-dynamic";

export default async function BooksSettingsPage() {
  if (!(await booksReady())) {
    return <section className="container-content py-12">Run the migration (<code>npm run db:migrate</code>) first.</section>;
  }
  const s = await booksSettings();
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/books" className="underline">Books</Link> · Fee rates
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Fee rates</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-2xl">
        Estimates for venues where FIA doesn&apos;t see the real fee. eBay orders use eBay&apos;s own fee. The
        defaults are a starting point — check each venue&apos;s current rates. &ldquo;Flat fee below&rdquo; is
        Poshmark&apos;s rule (a flat fee instead of the percent under a price). &ldquo;Buyer pays label&rdquo; sets
        postage to $0.
      </p>
      <FeeForm fees={s.fees} buyerPaid={s.buyerPaidLabel} />
    </section>
  );
}
