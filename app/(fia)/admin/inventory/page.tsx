import { db, items } from "@/db";
import { desc } from "drizzle-orm";
import Link from "next/link";

export default async function InventoryPage() {
  const rows = await db
    .select()
    .from(items)
    .orderBy(desc(items.capturedAt))
    .limit(50);

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Inventory
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Captured items
          </h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Dashboard
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-2">
            No items captured yet.
          </p>
          <p className="text-brand-ink/60 max-w-md mx-auto">
            Once the Chrome extension is built (Phase 2C), it will POST
            new items here when you browse your Nifty.ai inventory.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-brand-ink/15 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-brand-paper border-b border-brand-ink/10">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Qty</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Captured</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-brand-ink/5 last:border-b-0"
                >
                  <td className="px-4 py-3 max-w-md truncate">{item.title}</td>
                  <td className="px-4 py-3 text-brand-ink/70">
                    {item.sku ?? "—"}
                  </td>
                  <td className="px-4 py-3">{item.quantity}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        "text-xs uppercase tracking-wider px-2 py-1 rounded " +
                        (item.status === "active"
                          ? "bg-brand-yellow/30 text-brand-ink"
                          : "bg-brand-ink/10 text-brand-ink/60")
                      }
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-ink/60">
                    {item.capturedAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
