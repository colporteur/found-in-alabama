// /admin/books/hauls — what each haul cost and what its items have brought in.

import Link from "next/link";
import { booksReady, journalPosts, listAcquisitions } from "@/lib/books/books";
import { EditHaul, HaulForm } from "../BooksControls";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${n.toFixed(2)}`;
const KIND: Record<string, string> = { estate_sale: "Estate sale", auction: "Auction", thrift: "Thrift", yard_sale: "Yard sale", online: "Online", other: "Other" };

export default async function HaulsPage() {
  if (!(await booksReady())) {
    return <section className="container-content py-12">Run the migration (<code>npm run db:migrate</code>) first.</section>;
  }
  const hauls = await listAcquisitions();
  const all = journalPosts();
  const postTitle = new Map(all.map((p) => [p.slug, p.title]));
  const taken = new Set(hauls.map((h) => h.postSlug).filter(Boolean));
  // Haul posts first; any post type can be tied (Private Notes match any slug).
  const posts = [...all.filter((p) => p.type === "haul"), ...all.filter((p) => p.type !== "haul")].map((p) => ({
    slug: p.slug,
    title: p.title,
    date: p.date,
  }));
  const open = all.filter((p) => p.type === "haul" && !taken.has(p.slug)).length;
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/books" className="underline">Books</Link> · Hauls
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Hauls</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-2xl">
        Record what you paid for a haul. Tie it to its journal post and every item whose Nifty Private Notes carry
        that post&apos;s slug counts toward it automatically; you can still pick a haul by hand on an item&apos;s
        listing page, and that wins. Items without a cost of their own share the haul&apos;s total evenly.
      </p>
      {open > 0 && (
        <p className="text-sm text-brand-ink/70 mb-3">
          {open} journal haul{open === 1 ? "" : "s"} {open === 1 ? "has" : "have"} no books entry yet — pick one under
          “Journal post” to add its cost.
        </p>
      )}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8">
        <HaulForm posts={posts} />
      </div>
      {!hauls.length ? (
        <p className="text-sm text-brand-ink/60">No hauls yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-brand-ink/60 border-b">
              <th className="py-2">Haul</th>
              <th className="py-2">Date</th>
              <th className="py-2">Kind</th>
              <th className="py-2 text-right">Paid</th>
              <th className="py-2 text-right">Items</th>
              <th className="py-2 text-right">Sold</th>
              <th className="py-2 text-right">Sales so far</th>
              <th className="py-2 text-right" title="Asking prices of the items not yet sold">Unsold asking</th>
              <th className="py-2 text-right" title="Unsold asking prices plus sales so far">Unsold + sales</th>
            </tr>
          </thead>
          <tbody>
            {hauls.map((h) => (
              <tr key={h.id} className="border-b align-top">
                <td className="py-2 pr-4">
                  {h.name}
                  {h.postSlug && (
                    <div className="text-xs">
                      Journal:{" "}
                      <Link href={`/journal/${h.postSlug}`} className="underline">
                        {postTitle.get(h.postSlug) ?? h.postSlug}
                      </Link>
                    </div>
                  )}
                  {h.notes && <div className="text-xs text-brand-ink/50">{h.notes}</div>}
                  <EditHaul
                    value={{
                      id: h.id,
                      name: h.name,
                      acquiredOn: h.acquiredOn ?? "",
                      kind: h.kind ?? "other",
                      totalCost: h.totalCost == null ? "" : h.totalCost.toFixed(2),
                      notes: h.notes ?? "",
                      postSlug: h.postSlug ?? "",
                    }}
                    posts={posts}
                  />
                </td>
                <td className="py-2 whitespace-nowrap">{h.acquiredOn ?? ""}</td>
                <td className="py-2">{h.kind ? KIND[h.kind] ?? h.kind : ""}</td>
                <td className="py-2 text-right">{h.totalCost == null ? "" : money(h.totalCost)}</td>
                <td className="py-2 text-right">
                  {h.items}
                  {h.itemsViaJournal > 0 && (
                    <div className="text-xs text-brand-ink/50" title="Counted through the journal slug in Nifty Private Notes">
                      {h.itemsViaJournal} via journal
                    </div>
                  )}
                </td>
                <td className="py-2 text-right">{h.itemsSold}</td>
                <td className="py-2 text-right">{money(h.revenue)}</td>
                <td className="py-2 text-right">
                  {money(h.unsoldAsking)}
                  <div className="text-xs text-brand-ink/50">
                    {h.itemsUnsold} unsold
                    {h.unsoldUnpriced > 0 && ` · ${h.unsoldUnpriced} unpriced`}
                  </div>
                </td>
                <td className="py-2 text-right">
                  {money(h.unsoldAsking + h.revenue)}
                  {h.totalCost != null && h.totalCost > 0 && (
                    <div className="text-xs text-brand-ink/50" title="Unsold asking plus sales, divided by what you paid">
                      {((h.unsoldAsking + h.revenue) / h.totalCost).toFixed(1)}× cost
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
