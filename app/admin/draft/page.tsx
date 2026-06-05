"use client";

import { useState } from "react";
import Link from "next/link";

type DraftResult = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  usage?: { inputTokens: number; outputTokens: number };
};

export default function DraftPage() {
  // We store the file's base64 + mediaType in state at pick time, NOT the
  // File reference. On iOS Safari, the File reference becomes invalid a
  // few seconds after the picker closes ("permission problems after a
  // reference to a file was acquired" error). Reading once up front and
  // holding the string avoids that.
  type ImageData = {
    base64: string;
    mediaType: string;
    previewUrl: string;
    fileName: string;
  };

  const [imageData, setImageData] = useState<ImageData | null>(null); // hero
  const [contextImageData, setContextImageData] = useState<ImageData | null>(null);
  const [contextUrl, setContextUrl] = useState("");
  const [acquisitionContext, setAcquisitionContext] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  function readImageFile(
    file: File,
    onSuccess: (data: ImageData) => void,
    onFail: (msg: string) => void
  ) {
    const reader = new FileReader();
    reader.onerror = () => {
      onFail(
        "Could not read the selected image. Try again, and don't switch apps between picking the file and the read finishing."
      );
    };
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!match) {
        onFail("Could not parse the image data.");
        return;
      }
      const [, mediaType, base64] = match;
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowedTypes.includes(mediaType)) {
        onFail(`Image type ${mediaType} not supported. Use JPG, PNG, WebP, or GIF.`);
        return;
      }
      onSuccess({ base64, mediaType, previewUrl: dataUrl, fileName: file.name });
    };
    reader.readAsDataURL(file);
  }

  function handleHeroFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setImageData(null);
      return;
    }
    readImageFile(
      file,
      (data) => {
        setError(null);
        setImageData(data);
      },
      (msg) => {
        setError(msg);
        setImageData(null);
      }
    );
  }

  function handleContextFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setContextImageData(null);
      return;
    }
    readImageFile(
      file,
      (data) => {
        setError(null);
        setContextImageData(data);
      },
      (msg) => {
        setError(msg);
        setContextImageData(null);
      }
    );
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPublishedUrl(null);
    if (!imageData) {
      setError("Please choose a hero image first.");
      return;
    }
    const totalContextLength =
      acquisitionContext.trim().length + photoNotes.trim().length;
    if (totalContextLength < 10 && !contextImageData && !contextUrl.trim()) {
      setError(
        "Add at least a sentence of context, or attach a context photo, or paste a source URL."
      );
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/admin/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData.base64,
          imageMediaType: imageData.mediaType,
          contextImageBase64: contextImageData?.base64,
          contextImageMediaType: contextImageData?.mediaType,
          acquisitionContext: acquisitionContext.trim(),
          photoNotes: photoNotes.trim(),
          contextUrl: contextUrl.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const draft = (await res.json()) as DraftResult;
      setResult(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handlePublish() {
    if (!result || !imageData) return;
    setError(null);
    setIsPublishing(true);
    try {
      const res = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: result.slug,
          title: result.title,
          excerpt: result.excerpt,
          body: result.body,
          featured: true,
          imageBase64: imageData.base64,
          imageMediaType: imageData.mediaType,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { postUrl: string };
      setPublishedUrl(data.postUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setIsPublishing(false);
    }
  }

  function buildMarkdown(r: DraftResult): string {
    const date = new Date().toISOString().split("T")[0];
    const slug = r.slug || "untitled-haul";
    return `---
title: "${r.title.replace(/"/g, '\\"')}"
date: "${date}"
type: "haul"
hero: "/photos/posts/${slug}-hero.jpg"
excerpt: "${r.excerpt.replace(/"/g, '\\"')}"
featured: true
items: []
---

${r.body}
`;
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildMarkdown(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError("Could not copy to clipboard. Manually copy from below.");
    }
  }

  return (
    <section className="container-content py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
            Generate
          </p>
          <h1 className="font-marker text-3xl md:text-4xl">
            Draft a haul narrative
          </h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-brand-ink/60 hover:text-brand-ink"
        >
          ← Dashboard
        </Link>
      </div>

      <p className="text-brand-ink/70 mb-8 max-w-prose">
        Upload a hero photo from a recent haul plus a few sentences of context.
        Claude will draft a complete journal post you can edit and copy as
        markdown.
      </p>

      <form onSubmit={handleGenerate} className="space-y-8 max-w-3xl">

        {/* ── Where it came from ─────────────────────────────────────── */}
        <fieldset className="border border-brand-ink/15 rounded-lg p-5 space-y-4">
          <legend className="font-marker text-lg px-2">Where it came from</legend>

          <div>
            <label
              htmlFor="acquisition-context"
              className="block text-sm font-medium mb-2"
            >
              Acquisition story
              <span className="text-brand-ink/50 font-normal ml-2">
                Estate, auction, source, dates, anything narrative
              </span>
            </label>
            <textarea
              id="acquisition-context"
              value={acquisitionContext}
              onChange={(e) => setAcquisitionContext(e.target.value)}
              rows={4}
              placeholder="e.g. Estate sale in Anniston, retired physician's family, sold over the weekend. Bought everything in the den plus the bookshelves in the back hall."
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Context photo
              <span className="text-brand-ink/50 font-normal ml-2">
                Optional — e.g. estate sale signage, the room before pack-out, auction catalog page
              </span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleContextFileChange}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-brand-ink/10 file:text-brand-ink hover:file:bg-brand-ink/20 file:cursor-pointer"
            />
            {contextImageData?.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={contextImageData.previewUrl}
                alt="Context preview"
                className="mt-3 rounded-md max-h-40 object-cover"
              />
            )}
            <p className="text-xs text-brand-ink/50 mt-1">
              Not saved with the post — used only to help Claude understand the source.
            </p>
          </div>

          <div>
            <label
              htmlFor="context-url"
              className="block text-sm font-medium mb-2"
            >
              Source URL
              <span className="text-brand-ink/50 font-normal ml-2">
                Optional — estate sale listing, auction page, etc. Claude reads it for proper nouns and dates.
              </span>
            </label>
            <input
              id="context-url"
              type="url"
              value={contextUrl}
              onChange={(e) => setContextUrl(e.target.value)}
              placeholder="https://www.estatesales.net/..."
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
          </div>
        </fieldset>

        {/* ── The haul ───────────────────────────────────────────────── */}
        <fieldset className="border border-brand-ink/15 rounded-lg p-5 space-y-4">
          <legend className="font-marker text-lg px-2">The haul</legend>

          <div>
            <label className="block text-sm font-medium mb-2">
              Hero photo
              <span className="text-brand-ink/50 font-normal ml-2">
                Required — JPG, PNG, WebP, or GIF. This is what readers will see.
              </span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleHeroFileChange}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-brand-yellow file:text-brand-ink hover:file:bg-brand-yellow-dark file:cursor-pointer"
            />
            {imageData?.previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageData.previewUrl}
                alt="Hero preview"
                className="mt-3 rounded-md max-h-64 object-cover"
              />
            )}
          </div>

          <div>
            <label
              htmlFor="photo-notes"
              className="block text-sm font-medium mb-2"
            >
              What&apos;s in the photo
              <span className="text-brand-ink/50 font-normal ml-2">
                Notable items visible in the hero image — gives Claude concrete details
              </span>
            </label>
            <textarea
              id="photo-notes"
              value={photoNotes}
              onChange={(e) => setPhotoNotes(e.target.value)}
              rows={4}
              placeholder="e.g. Stack of medical journals, a 1970s boombox, a leather portfolio, a vinyl record sleeve, an IKEA bag for scale."
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow resize-y"
            />
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={
              isGenerating ||
              !imageData ||
              (acquisitionContext.trim().length + photoNotes.trim().length < 10 &&
                !contextImageData &&
                !contextUrl.trim())
            }
            className="inline-flex items-center justify-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? "Generating…" : "Generate draft with Claude →"}
          </button>
          <span className="text-xs text-brand-ink/50">
            ~$0.02 per generation · Sonnet
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
            {error}
          </div>
        )}
      </form>

      {result && (
        <div className="mt-12 pt-8 border-t border-brand-ink/10 max-w-3xl">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
                Draft
              </p>
              <h2 className="font-marker text-2xl md:text-3xl">
                Edit and copy
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handlePublish}
                disabled={isPublishing || !!publishedUrl}
                className="inline-flex items-center px-4 py-2 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPublishing
                  ? "Publishing…"
                  : publishedUrl
                  ? "Published ✓"
                  : "Publish to site →"}
              </button>
              <button
                onClick={handleCopy}
                className="inline-flex items-center px-4 py-2 bg-transparent text-brand-ink border border-brand-ink/30 font-medium rounded-md hover:bg-brand-ink/5 transition-colors text-sm"
              >
                {copied ? "Copied!" : "Copy markdown"}
              </button>
            </div>
          </div>

          {publishedUrl && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-6 text-sm text-emerald-900">
              <p className="font-medium mb-1">
                Published. Vercel is rebuilding now.
              </p>
              <p>
                Your post will be live at{" "}
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-emerald-600 decoration-2 underline-offset-2"
                >
                  {publishedUrl}
                </a>{" "}
                in about a minute (refresh that page once Vercel finishes).
              </p>
            </div>
          )}

          <div className="space-y-5">
            <Field label="Title">
              <input
                type="text"
                value={result.title}
                onChange={(e) =>
                  setResult({ ...result, title: e.target.value })
                }
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md font-marker text-2xl bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
              />
            </Field>

            <Field label="Slug" hint="The URL segment. Lowercase, hyphens only.">
              <input
                type="text"
                value={result.slug}
                onChange={(e) =>
                  setResult({ ...result, slug: e.target.value })
                }
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md font-mono text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow"
              />
            </Field>

            <Field label="Excerpt" hint="Shows in the journal index and social previews.">
              <textarea
                value={result.excerpt}
                onChange={(e) =>
                  setResult({ ...result, excerpt: e.target.value })
                }
                rows={2}
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow resize-y"
              />
            </Field>

            <Field label="Body" hint="Markdown. Will be rendered with paragraph breaks.">
              <textarea
                value={result.body}
                onChange={(e) =>
                  setResult({ ...result, body: e.target.value })
                }
                rows={14}
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-base leading-relaxed bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow resize-y"
              />
            </Field>
          </div>

          {result.usage && (
            <p className="text-xs text-brand-ink/50 mt-6">
              Used {result.usage.inputTokens.toLocaleString()} input + {result.usage.outputTokens.toLocaleString()} output tokens
            </p>
          )}

          <details className="mt-8 bg-brand-paper border border-brand-ink/10 rounded-md p-5">
            <summary className="text-sm font-medium cursor-pointer text-brand-ink/70">
              Manual publish fallback (if &ldquo;Publish to site&rdquo; fails)
            </summary>
            <ol className="mt-3 text-sm text-brand-ink/80 space-y-1 list-decimal list-inside">
              <li>Click &quot;Copy markdown&quot; above</li>
              <li>
                Create a new file at{" "}
                <code className="bg-white px-1 rounded">
                  content/posts/{result.slug || "your-slug"}.md
                </code>{" "}
                and paste
              </li>
              <li>
                Drop your hero photo at{" "}
                <code className="bg-white px-1 rounded">
                  public/photos/posts/{result.slug || "your-slug"}-hero.jpg
                </code>
              </li>
              <li>
                <code className="bg-white px-1 rounded">git add . &amp;&amp; git commit -m &quot;Add {result.slug || "post"}&quot; &amp;&amp; git push</code>
              </li>
            </ol>
          </details>
        </div>
      )}
    </section>
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
