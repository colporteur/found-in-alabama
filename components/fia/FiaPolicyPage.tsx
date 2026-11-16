// Shared frame for Found in Alabama's plain policy pages (returns,
// shipping): back link, marker heading, readable column.

import Link from "next/link";

export default function FiaPolicyPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="container-content py-12">
      <Link href="/" className="text-sm text-brand-ink/60 hover:text-brand-ink">
        ← Home
      </Link>
      <header className="mt-6 mb-8">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">{eyebrow}</p>
        <h1 className="font-marker text-4xl md:text-5xl leading-tight mb-3">{title}</h1>
        {intro && <p className="text-brand-ink/75 max-w-prose">{intro}</p>}
      </header>
      <div className="max-w-prose space-y-8 leading-relaxed text-brand-ink/85">{children}</div>
    </article>
  );
}

export function FiaSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-marker text-2xl mb-2">{heading}</h2>
      {children}
    </section>
  );
}

export const fiaLink = "underline decoration-brand-yellow decoration-2 underline-offset-2";
