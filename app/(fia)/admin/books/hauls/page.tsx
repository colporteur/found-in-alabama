// /admin/books/hauls — what each haul cost and what its items have brought in.

import Link from "next/link";
import { booksReady, listAcquisitions } from "@/lib/books/books";
import { EditHaul, HaulForm } from "../BooksControls";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${n.toFixed(2)}`;
const KIND: Record<string, string> = { estate_sale: "Estate sale", auction: "Auction", thrift: "Thrift", yard_sale: "Yard sale", online: "Online", other: "Other" };

export default async function HaulsPage() {
  if (!(await booksReady())) {
    return <section className="container-content py-12">Run the migration (<code>npm run db:migrate</code>) first.</section>;
  }
  const hauls = await listAcquisitions();
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/books" className="underline">Books</Link> · Hauls
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">Hauls</h1>
      <p className="text-sm text-brand-ink/60 mb-6 max-w-2xl">
        Record what you paid for a haul, then pick it on each item&apos;s listing page (optional — skip anything
        you can&apos;t place). Items without a cost of their own share the haul&apos;s total evenly.
      </p>
      <div className="bg-white border border-brand-ink/15 rounded-lg p-4 mb-8">
        <HaulForm />
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
            </tr>
          </thead>
          <tbody>
            {hauls.map((h) => (
              <tr key={h.id} className="border-b align-top">
                <td className="py-2 pr-4">
                  {h.name}
                  {h.notes && <div className="text-xs text-brand-ink/50">{h.notes}</div>}
                  <EditHaul
                    value={{
                      id: h.id,
                      name: h.name,
                      acquiredOn: h.acquiredOn ?? "",
                      kind: h.kind ?? "other",
                      totalCost: h.totalCost == null ? "" : h.totalCost.toFixed(2),
                      notes: h.notes ?? "",
                    }}
                  />
                </td>
                <td className="py-2 whitespace-nowrap">{h.acquiredOn ?? ""}</td>
                <td className="py-2">{h.kind ? KIND[h.kind] ?? h.kind : ""}</td>
                <td className="py-2 text-right">{h.totalCost == null ? "" : money(h.totalCost)}</td>
                <td className="py-2 text-right">{h.items}</td>
                <td className="py-2 text-right">{h.itemsSold}</td>
                <td className="py-2 text-right">{money(h.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
