import { auth } from "@/auth";
import { db, items } from "@/db";
import { count, eq } from "drizzle-orm";
import Link from "next/link";

export default async function AdminDashboard() {
  const session = await auth();

  const [activeRow] = await db
    .select({ count: count() })
    .from(items)
    .where(eq(items.status, "active"));
  const [soldRow] = await db
    .select({ count: count() })
    .from(items)
    .where(eq(items.status, "sold"));

  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
        Welcome back
      </p>
      <h1 className="font-marker text-4xl md:text-5xl mb-2">
        Hi, {session?.user?.email?.split("@")[0]}.
      </h1>
      <p className="text-brand-ink/70 mb-10">
        Phase 2A foundation is live. The dashboard will fill in as the
        Chrome extension and post editor come online.
      </p>

      <div className="grid gap-4 sm:grid-cols-3 mb-10">
        <Stat label="Active inventory" value={activeRow?.count ?? 0} />
        <Stat label="Sold" value={soldRow?.count ?? 0} />
        <Stat
          label="Captured today"
          value={0}
          hint="Chrome extension not yet built (Phase 2C)"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 max-w-3xl">
        <PhaseCard
          status="ready"
          phase="2A"
          title="Auth + database"
          desc="You're using it now. Sign-in works, items table is ready."
        />
        <PhaseCard
          status="ready"
          phase="2B"
          title="Claude API drafts"
          desc="Generate haul narratives from a hero photo + brief notes."
          href="/admin/draft"
        />
        <PhaseCard
          status="ready"
          phase="2C"
          title="Chrome extension"
          desc="Capture items from Nifty when you visit your inventory page."
        />
        <PhaseCard
          status="ready"
          phase="2D"
          title="Social copy"
          desc="Generate tailored posts per channel (Instagram, Facebook, Pinterest, BlueSky, X)."
          href="/admin/social"
        />
      </div>

      <div className="mt-12 pt-6 border-t border-brand-ink/10 flex flex-wrap gap-6">
        <Link
          href="/admin/draft"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Draft a haul narrative →
        </Link>
        <Link
          href="/admin/drafts"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Saved drafts →
        </Link>
        <Link
          href="/admin/journal"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Manage haul posts →
        </Link>
        <Link
          href="/admin/social"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Generate social copy →
        </Link>
        <Link
          href="/admin/social/queue"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Social queue →
        </Link>
        <Link
          href="/admin/settings/posting"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Posting connections →
        </Link>
        <Link
          href="/admin/inventory"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Browse inventory →
        </Link>
        <Link
          href="/admin/newsletter"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Newsletter subscribers →
        </Link>
        <Link
          href="/admin/newsletter/drafts"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          Newsletter drafts →
        </Link>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
        {label}
      </p>
      <p className="font-marker text-3xl mb-1">{value.toLocaleString()}</p>
      {hint && <p className="text-xs text-brand-ink/50">{hint}</p>}
    </div>
  );
}

function PhaseCard({
  status,
  phase,
  title,
  desc,
  href,
}: {
  status: "ready" | "next" | "pending";
  phase: string;
  title: string;
  desc: string;
  href?: string;
}) {
  const badge =
    status === "ready"
      ? "bg-brand-yellow text-brand-ink"
      : status === "next"
      ? "bg-brand-ink text-brand-paper"
      : "bg-brand-ink/10 text-brand-ink/60";
  const label =
    status === "ready" ? "Live" : status === "next" ? "Up next" : "Pending";

  const inner = (
    <>
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-marker text-base text-brand-ink/40">Phase {phase}</p>
        <span
          className={`text-xs uppercase tracking-wider px-2 py-1 rounded ${badge}`}
        >
          {label}
        </span>
      </div>
      <h3 className="font-medium text-lg mb-1">{title}</h3>
      <p className="text-sm text-brand-ink/70 leading-relaxed">{desc}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white border border-brand-ink/15 rounded-lg p-5 hover:border-brand-yellow transition-colors"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      {inner}
    </div>
  );
}
