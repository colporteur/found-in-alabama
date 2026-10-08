// /admin/listings/settings — which model writes each tier, how many photos
// it sees, when it retries one tier up, and the price floors (LIST-2).

import Link from "next/link";
import { writerSettings } from "@/lib/listings/writer";
import { DEFAULT_WRITER_SETTINGS } from "@/lib/listings/rules";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function WriterSettingsPage() {
  const s = await writerSettings();
  return (
    <section className="container-content py-12 max-w-3xl">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>{" "}
        · settings
      </p>
      <h1 className="font-marker text-4xl mb-4">Listing writer</h1>
      <p className="text-sm text-brand-ink/70 mb-6">
        A quick first look (the identify model) decides how hard each item is. Common postcards and simple paper go to the
        Simple model; most items to General; artwork, signed, valuable (≈$75+) or hard items to Premium. When the writer is less
        sure than the retry threshold, it tries once more one tier up. Model names are OpenRouter ids (e.g.{" "}
        <code>anthropic/claude-sonnet-5</code>) or aliases from Admin → AI Models.
      </p>
      <SettingsForm initial={s} defaults={DEFAULT_WRITER_SETTINGS} />
    </section>
  );
}
