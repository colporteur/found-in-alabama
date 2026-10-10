// /admin/labels/print?k=r:<id>,d:<id>,… — the label sheet for the DYMO.

import { labelItems } from "@/lib/labels/items";
import { LabelSheets } from "./LabelSheets";

export const dynamic = "force-dynamic";

export default async function LabelPrintPage({ searchParams }: { searchParams: { k?: string } }) {
  const keys = (searchParams.k ?? "").split(",").filter(Boolean).slice(0, 500);
  const items = await labelItems(keys);
  return <LabelSheets items={items.map((i) => ({ key: i.key, title: i.title, price: i.price }))} />;
}
