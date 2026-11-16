// Shared frame for The Ephemeral State's plain-text pages (about, contact,
// shipping, privacy, returns): back link, typewriter heading, intro line,
// readable column.

import Link from "next/link";
import { tesHome } from "@/lib/tes/host";

export default function TesPolicyPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="container-content py-12">
      <Link href={tesHome()} className="text-sm text-tes-ink/60 hover:text-tes-ink">
        ← Home
      </Link>
      <h1 className="font-typewriter text-3xl md:text-5xl leading-tight mt-3 mb-2">
        {title}
      </h1>
      {intro && <p className="text-tes-ink/70 mb-10 max-w-prose">{intro}</p>}
      <div className="max-w-prose space-y-8 text-tes-ink/90 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

export function TesSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-typewriter text-xl mb-2">{heading}</h2>
      {children}
    </div>
  );
}

export const tesLink =
  "text-tes-kraft-dark underline underline-offset-2 hover:text-tes-ink";
