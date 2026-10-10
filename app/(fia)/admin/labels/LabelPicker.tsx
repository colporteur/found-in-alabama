"use client";

// Pick items for labels, then open the print sheet in a new tab.

import { useState } from "react";
import type { LabelItem } from "@/lib/labels/items";

export function LabelPicker({ items }: { items: LabelItem[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(items.map((i) => i.key)));
  const keys = items.filter((i) => sel.has(i.key)).map((i) => i.key);
  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const btn = "text-sm px-3 py-1.5 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";

  if (!items.length) return <p className="text-brand-ink/60 text-sm">No items found.</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 sticky top-0 bg-white/95 py-2 z-10">
        <span className="text-sm text-brand-ink/70 mr-2">
          {keys.length} of {items.length} selected
        </span>
        <button type="button" className={btn} onClick={() => setSel(new Set(items.map((i) => i.key)))}>
          All
        </button>
        <button type="button" className={btn} onClick={() => setSel(new Set())}>
          None
        </button>
        <button
          type="button"
          disabled={!keys.length}
          onClick={() => window.open(`/admin/labels/print?k=${keys.join(",")}`, "_blank")}
          className="text-sm px-3 py-1.5 rounded bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-40"
        >
          Print {keys.length} label{keys.length === 1 ? "" : "s"}
        </button>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {items.map((i) => (
            <tr key={i.key} className="border-b hover:bg-brand-ink/5 cursor-pointer" onClick={() => toggle(i.key)}>
              <td className="py-2 w-8">
                <input type="checkbox" checked={sel.has(i.key)} onChange={() => toggle(i.key)} onClick={(e) => e.stopPropagation()} />
              </td>
              <td className="py-2 w-14">
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt="" className="w-10 h-10 object-cover rounded" loading="lazy" />
                ) : (
                  <div className="w-10 h-10 rounded bg-brand-ink/10" />
                )}
              </td>
              <td className="py-2 pr-4">{i.title}</td>
              <td className="py-2 pr-4 font-mono whitespace-nowrap">{i.binSku ?? ""}</td>
              <td className="py-2 text-right whitespace-nowrap">
                {i.price != null ? `$${i.price.toFixed(2)}` : <span className="text-amber-700 text-xs">no price</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
