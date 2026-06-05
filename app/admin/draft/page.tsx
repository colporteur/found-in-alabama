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
  const [imageData, setImageData] = useState<{
    base64: string;
    mediaType: string;
    previewUrl: string;
    fileName: string;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setImageData(null);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setError(
        "Could not read the selected image. Try again, and don't switch apps between picking the file and the read finishing."
      );
      setImageData(null);
    };
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!match) {
        setError("Could not parse the image data.");
        setImageData(null);
        return;
      }
      const [, mediaType, base64] = match;
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!allowedTypes.includes(mediaType)) {
        setError(
          `Image type ${mediaType} not supported. Use JPG, PNG, WebP, or GIF.`
        );
        setImageData(null);
        return;
      }
      setError(null);
      setImageData({
        base64,
        mediaType,
        previewUrl: dataUrl,
        fileName: file.name,
      });
    };
    reader.readAsDataURL(file);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!imageData) {
      setError("Please choose a hero image first.");
      return;
    }
    if (notes.trim().length < 10) {
      setError("Add at least a sentence of notes about this haul.");
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
          notes: notes.trim(),
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

      <form onSubmit={handleGenerate} className="space-y-6 max-w-3xl">
        <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
          <label className="block text-sm font-medium mb-2">
            Hero image
            <span className="text-brand-ink/50 font-normal ml-2">
              JPG, PNG, WebP, or GIF
            </span>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-brand-yellow file:text-brand-ink hover:file:bg-brand-yellow-dark file:cursor-pointer"
          />
          {imageData?.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageData.previewUrl}
              alt="Preview"
              className="mt-4 rounded-md max-h-64 object-cover"
            />
          )}
        </div>

        <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
          <label htmlFor="notes" className="block text-sm font-medium mb-2">
            Notes about this haul
            <span className="text-brand-ink/50 font-normal ml-2">
              Where it came from, kinds of items, anything notable
            </span>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="e.g. Estate of a retired physician in Anniston. Mid-century furniture, medical books and journals, a few signed prints. Acquired April 22 — packing now."
            className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow resize-y"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isGenerating || !imageData || notes.trim().length < 10}
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
            <button
              onClick={handleCopy}
              className="inline-flex items-center px-4 py-2 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors text-sm"
            >
              {copied ? "Copied!" : "Copy as markdown"}
            </button>
          </div>

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

          <div className="mt-8 bg-brand-yellow/20 border border-brand-yellow rounded-md p-5">
            <p className="text-sm font-medium mb-2">Next steps</p>
            <ol className="text-sm text-brand-ink/80 space-y-1 list-decimal list-inside">
              <li>Click &quot;Copy as markdown&quot; above</li>
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
          </div>
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
