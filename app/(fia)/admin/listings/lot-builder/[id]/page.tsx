// /admin/listings/lot-builder/:id — one sort session: pull and photo alerts,
// the proposed lots, pieces not placed yet, and a printable sorting guide.

import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBuild, lotBuildReady } from "@/lib/listings/lot-build";
import { BuildBoard } from "./BuildBoard";

export const dynamic = "force-dynamic";

export default async function LotBuildPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id) || !(await lotBuildReady())) notFound();
  const build = await loadBuild(params.id).catch(() => null);
  if (!build) notFound();
  return (
    <section className="w-full px-4 md:px-6 py-10">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3 print:hidden">
        <Link href="/admin/listings" className="underline">
          Listings
        </Link>{" "}
        ·{" "}
        <Link href="/admin/listings/lot-builder" className="underline">
          Lot Builder
        </Link>
      </p>
      <BuildBoard build={build} />
    </section>
  );
}
