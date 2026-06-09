"use client";

// Edit form for one haul post. PATCHes /api/admin/posts/[slug] which
// commits the updated markdown to GitHub. Vercel rebuilds in ~1 minute.

import { useMemo, useState } from "react";

export type InitialPost = {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  body: string;
  featured: boolean;
  city: string;
  state: string;
  vagueLocation: string;
  hero: string;
  galleryCount: number;
};

export default function EditPostClient({ initial }: { initial: InitialPost }) {
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [body, setBody] = useState(initial.body);
  const [featured, setFeatured] = useState(initial.featured);
  const [city, setCity] = useState(initial.city);
  const [stateName, setStateName] = useState(initial.state || "Alabama");
  const [vagueLocation, setVagueLocation] = useState(initial.vagueLocation);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    commitUrl: string;
  } | null>(null);

  const dirty = useMemo(() => {
    return (
      title !== initial.title ||
      date !== initial.date ||
      excerpt !== initial.excerpt ||
      body !== initial.body ||
      featured !== initial.featured ||
      city !== initial.city ||
      stateName !== (initial.state || "Alabama") ||
      vagueLocation !== initial.vagueLocation
    );
  }, [
    title,
    date,
    excerpt,
    body,
    featured,
    city,
    stateName,
    vagueLocation,
    initial,
  ]);

  const locationPreview = vagueLocation.trim()
    ? `Public display: "${vagueLocation.trim()}"`
    : city.trim() && stateName.trim()
      ? `Public display: "${city.trim()}, ${stateName.trim()}"`
      : city.trim()
        ? `Public display: "${city.trim()}"`
        : stateName.trim()
          ? `Public display: "${stateName.trim()}"`
          : "Public display: (none)";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/posts/${encodeURIComponent(initial.slug)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            date: date.trim(),
            excerpt: excerpt.trim(),
            body: body,
            featured,
            city: city.trim() || null,
            state: stateName.trim() || null,
            vagueLocation: vagueLocation.trim() || null,
          }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { commitUrl: string };
      setSuccess({ commitUrl: data.commitUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      {/* Read-only summary at the top */}
      <div className="border border-brand-ink/10 bg-brand-paper rounded-md p-4 text-xs text-brand-ink/70 flex flex-wrap gap-x-6 gap-y-1">
        <span>
          <span className="uppercase tracking-wider mr-1">Slug:</span>
          <code className="bg-white px-1.5 py-0.5 rounded">{initial.slug}</code>
        </span>
        <span>
          <span className="uppercase tracking-wider mr-1">Hero:</span>
          <code className="bg-white px-1.5 py-0.5 rounded">
            {initial.hero || "(none)"}
          </code>
        </span>
        <span>
          <span className="uppercase tracking-wider mr-1">Gallery:</span>
          {initial.galleryCount} photo{initial.galleryCount === 1 ? "" : "s"}
        </span>
      </div>

      <FieldRow>
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-3 border border-brand-ink/20 rounded-md font-marker text-2xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
          />
        </Field>
      </FieldRow>

      <FieldRow cols={2}>
        <Field label="Date" hint="YYYY-MM-DD">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
          />
        </Field>
        <Field label="Featured">
          <label className="flex items-center gap-2 px-4 py-3 border border-brand-ink/20 rounded-md bg-white cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="accent-brand-yellow"
            />
            Show in featured slots on the home page
          </label>
        </Field>
      </FieldRow>

      <Field
        label="Excerpt"
        hint="Shows in the journal index and social previews."
      >
        <textarea
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          rows={2}
          className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow resize-y"
        />
      </Field>

      <fieldset className="border border-brand-ink/15 rounded-lg p-5 space-y-4">
        <legend className="font-marker text-lg px-2">Location</legend>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="City">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Anniston"
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
            />
          </Field>
          <Field label="State">
            <input
              type="text"
              value={stateName}
              onChange={(e) => setStateName(e.target.value)}
              placeholder="Alabama"
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
            />
          </Field>
        </div>
        <Field
          label="Vague location"
          hint="Overrides city + state when you don't want to reveal the source."
        >
          <input
            type="text"
            value={vagueLocation}
            onChange={(e) => setVagueLocation(e.target.value)}
            placeholder="e.g. central Alabama"
            className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
          />
        </Field>
        <p className="text-xs text-brand-ink/50">{locationPreview}</p>
      </fieldset>

      <Field
        label="Body"
        hint="Markdown. Paragraph breaks render as new paragraphs."
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-base leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow resize-y font-sans"
        />
      </Field>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving || !dirty}
          className="inline-flex items-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : dirty ? "Save changes →" : "No changes to save"}
        </button>
        {dirty && (
          <span className="text-xs text-brand-ink/55">
            Unsaved changes — Vercel rebuilds after save
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 text-sm text-emerald-900">
          <p className="font-medium mb-1">Saved. Vercel is rebuilding.</p>
          <p>
            Changes will be live at{" "}
            <a
              href={`/journal/${initial.slug}`}
              className="underline decoration-emerald-600 decoration-2 underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              /journal/{initial.slug}
            </a>{" "}
            in about a minute. (
            <a
              href={success.commitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-emerald-600 decoration-2 underline-offset-2"
            >
              View commit
            </a>
            )
          </p>
        </div>
      )}
    </form>
  );
}

function FieldRow({
  children,
  cols = 1,
}: {
  children: React.ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <div className={cols === 2 ? "grid sm:grid-cols-2 gap-4" : ""}>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      {hint && <p className="text-xs text-brand-ink/50 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
