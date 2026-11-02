// /admin/labels/address?tes=<order id>,…&ship=<package id>,… — buyer address
// labels for the DYMO (11354, 57 × 32 mm), from the TES orders page and the
// ship page.

import { addressLabels } from "@/lib/labels/address";
import { AddressSheets } from "./AddressSheets";

export const dynamic = "force-dynamic";

export default async function AddressLabelPage({ searchParams }: { searchParams: { tes?: string; ship?: string } }) {
  const split = (v?: string) => (v ?? "").split(",").filter(Boolean);
  const labels = await addressLabels(split(searchParams.tes), split(searchParams.ship));
  return <AddressSheets labels={labels} />;
}
