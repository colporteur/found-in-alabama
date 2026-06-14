"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DraftResult = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  usage?: { inputTokens: number; outputTokens: number };
};

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

// Keep these in sync with the API route's caps.
const MAX_HERO_IMAGES = 8;
const MAX_CONTEXT_IMAGES = 5;

export default function DraftPage() {
  const [heroImages, setHeroImages] = useState<ImageData[]>([]);
  const [contextImages, setContextImages] = useState<ImageData[]>([]);
  const [contextUrl, setContextUrl] = useState("");
  const [acquisitionContext, setAcquisitionContext] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  // Phase 3C — location fields
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("Alabama");
  const [vagueLocation, setVagueLocation] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  // Prefill from Sale Finder's "Send to FIA" button (query params on /admin/draft)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ctx = p.get("context");
    if (ctx) setAcquisitionContext(ctx);
    const c = p.get("city");
    if (c) setCity(c);
    const st = p.get("state");
    if (st) setStateName(st);
    const u = p.get("url");
    if (u) setContextUrl(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the file as a data URL — used as the first step for both the
  // compression path AND the GIF passthrough.
  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(
          new Error(
            "Could not read the selected image. Try again, and don't switch apps between picking the file and the read finishing."
          )
        );
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  // Load a data URL into an HTMLImageElement so we can draw it onto a
  // canvas for compression.
  function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image decode failed."));
      img.src = dataUrl;
    });
  }

  // Resize + re-encode a photo to keep Vercel's 4.5 MB request body
  // limit happy. Phone photos arrive at 4–12 MB; after this they're
  // ~200–400 KB at 1280px long edge and JPEG quality 0.82. GIFs are
  // preserved as-is so we don't lose animation.
  async function readImageFile(file: File): Promise<ImageData> {
    const dataUrl = await readAsDataUrl(file);
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) throw new Error("Could not parse the image data.");
    const [, srcMediaType] = match;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(srcMediaType)) {
      throw new Error(
        `Image type ${srcMediaType} not supported. Use JPG, PNG, WebP, or GIF.`
      );
    }
    // GIFs: skip canvas re-encode so animated frames survive.
    if (srcMediaType === "image/gif") {
      const [, , base64] = match;
      return {
        base64,
        mediaType: srcMediaType,
        previewUrl: dataUrl,
        fileName: file.name,
      };
    }

    const img = await dataUrlToImage(dataUrl);
    const MAX_DIM = 1280;
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      // Canvas unavailable — fall back to original (better than failing
      // outright; user may still squeak under the 413 limit).
      const [, , base64] = match;
      return {
        base64,
        mediaType: srcMediaType,
        previewUrl: dataUrl,
        fileName: file.name,
      };
    }
    ctx.drawImage(img, 0, 0, w, h);
    const newDataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const newMatch = newDataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!newMatch) throw new Error("Could not encode compressed image.");
    const [, mediaType, base64] = newMatch;
    return {
      base64,
      mediaType,
      previewUrl: newDataUrl,
      fileName: file.name,
    };
  }

  async function appendFiles(
    incoming: FileList | null,
    current: ImageData[],
    setter: (next: ImageData[]) => void,
    max: number
  ) {
    if (!incoming || incoming.length === 0) return;
    const room = max - current.length;
    if (room <= 0) {
      setError(`You've already added the maximum of ${max} photos here.`);
      return;
    }
    const toRead = Array.from(incoming).slice(0, room);
    const dropped = incoming.length - toRead.length;
    try {
      const newOnes = await Promise.all(toRead.map(readImageFile));
      setError(null);
      setter([...current, ...newOnes]);
      if (dropped > 0) {
        setError(
          `Added ${newOnes.length}. Skipped ${dropped} because the limit is ${max}.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read images.");
    }
  }

  function removeAt(
    index: number,
    current: ImageData[],
    setter: (next: ImageData[]) => void
  ) {
    setter(current.filter((_, i) => i !== index));
  }

  function moveToFront(
    index: number,
    current: ImageData[],
    setter: (next: ImageData[]) => void
  ) {
    if (index === 0) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.unshift(moved);
    setter(next);
  }

  // Move a context photo into the hero list at position 0 (so it becomes
  // the public hero image). The hero cap still applies — if we're at max,
  // surface an error instead of dropping anything.
  function promoteContextToHero(index: number) {
    const picked = contextImages[index];
    if (!picked) return;
    if (heroImages.length >= MAX_HERO_IMAGES) {
      setError(
        `You already have the maximum of ${MAX_HERO_IMAGES} haul photos. Remove one before promoting a context photo.`
      );
      return;
    }
    setError(null);
    setContextImages(contextImages.filter((_, i) => i !== index));
    setHeroImages([picked, ...heroImages]);
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPublishedUrl(null);
    if (heroImages.length === 0) {
      setError("Please add at least one haul photo first.");
      return;
    }
    const totalContextLength =
      acquisitionContext.trim().length + photoNotes.trim().length;
    if (
      totalContextLength < 10 &&
      contextImages.length === 0 &&
      !contextUrl.trim()
    ) {
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
          heroImages: heroImages.map((i) => ({
            base64: i.base64,
            mediaType: i.mediaType,
          })),
          contextImages: contextImages.map((i) => ({
            base64: i.base64,
            mediaType: i.mediaType,
          })),
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
    if (!result || heroImages.length === 0) return;
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
          haulImages: heroImages.map((i) => ({
            base64: i.base64,
            mediaType: i.mediaType,
          })),
          city: city.trim() || undefined,
          state: stateName.trim() || undefined,
          vagueLocation: vagueLocation.trim() || undefined,
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

  function extForMedia(mt: string): string {
    if (mt === "image/png") return "png";
    if (mt === "image/webp") return "webp";
    if (mt === "image/gif") return "gif";
    return "jpg";
  }

  function buildMarkdown(r: DraftResult): string {
    const date = new Date().toISOString().split("T")[0];
    const slug = r.slug || "untitled-haul";
    const heroExt =
      heroImages[0] ? extForMedia(heroImages[0].mediaType) : "jpg";
    const galleryYaml =
      heroImages.length > 1
        ? `gallery:\n${heroImages
            .slice(1)
            .map(
              (img, i) =>
                `  - "/photos/posts/${slug}-${i + 1}.${extForMedia(img.mediaType)}"`
            )
            .join("\n")}\n`
        : "";
    return `---
title: "${r.title.replace(/"/g, '\\"')}"
date: "${date}"
type: "haul"
hero: "/photos/posts/${slug}-hero.${heroExt}"
${galleryYaml}excerpt: "${r.excerpt.replace(/"/g, '\\"')}"
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
    } catch {
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
        Upload one or more photos from a recent haul plus a few sentences of
        context. Claude will draft a complete journal post you can edit and
        publish. The first haul photo becomes the hero; the rest show up in a
        gallery below the narrative.
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
              Context photos{" "}
              <span className="text-brand-ink/50 font-normal ml-1">
                ({contextImages.length}/{MAX_CONTEXT_IMAGES})
              </span>
              <span className="text-brand-ink/50 font-normal ml-2 block mt-1">
                Optional — estate sale signage, the room before pack-out, auction catalog page
              </span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) =>
                appendFiles(
                  e.target.files,
                  contextImages,
                  setContextImages,
                  MAX_CONTEXT_IMAGES
                ).finally(() => {
                  e.target.value = "";
                })
              }
              disabled={contextImages.length >= MAX_CONTEXT_IMAGES}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-brand-ink/10 file:text-brand-ink hover:file:bg-brand-ink/20 file:cursor-pointer disabled:opacity-50"
            />
            {contextImages.length > 0 && (
              <ThumbnailGrid
                images={contextImages}
                onRemove={(i) =>
                  removeAt(i, contextImages, setContextImages)
                }
                onPromoteToHero={promoteContextToHero}
              />
            )}
            <p className="text-xs text-brand-ink/50 mt-2">
              Claude reads these for source context. Hover any thumbnail and click
              &ldquo;Use as hero →&rdquo; to publish it as the displayed photo instead
              (useful when the estate sign or pre-pack-out room makes a better lead
              than the haul photo).
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

        {/* ── Location ───────────────────────────────────────────────── */}
        <fieldset className="border border-brand-ink/15 rounded-lg p-5 space-y-4">
          <legend className="font-marker text-lg px-2">Location</legend>
          <p className="text-xs text-brand-ink/60 -mt-2">
            Shows on the haul page and starts product social posts as
            &ldquo;Found in [location]&hellip;&rdquo;. Use vague location to
            avoid revealing exact sourcing spots — it overrides city + state
            when set.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="city"
                className="block text-sm font-medium mb-2"
              >
                City
                <span className="text-brand-ink/50 font-normal ml-2">Optional</span>
              </label>
              <input
                id="city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Anniston"
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
            <div>
              <label
                htmlFor="state"
                className="block text-sm font-medium mb-2"
              >
                State
              </label>
              <input
                id="state"
                type="text"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                placeholder="Alabama"
                className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="vague-location"
              className="block text-sm font-medium mb-2"
            >
              Vague location
              <span className="text-brand-ink/50 font-normal ml-2">
                Overrides city + state when you don&rsquo;t want to reveal the source
              </span>
            </label>
            <input
              id="vague-location"
              type="text"
              value={vagueLocation}
              onChange={(e) => setVagueLocation(e.target.value)}
              placeholder="e.g. central Alabama, the Black Belt, north of Birmingham"
              className="w-full px-4 py-3 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
            />
            <p className="text-xs text-brand-ink/50 mt-1">
              {vagueLocation.trim()
                ? `Public display: "${vagueLocation.trim()}"`
                : city.trim() && stateName.trim()
                  ? `Public display: "${city.trim()}, ${stateName.trim()}"`
                  : city.trim()
                    ? `Public display: "${city.trim()}"`
                    : stateName.trim()
                      ? `Public display: "${stateName.trim()}"`
                      : "Public display: (none — haul page won't show a location)"}
            </p>
          </div>
        </fieldset>

        {/* ── The haul ───────────────────────────────────────────────── */}
        <fieldset className="border border-brand-ink/15 rounded-lg p-5 space-y-4">
          <legend className="font-marker text-lg px-2">The haul</legend>

          <div>
            <label className="block text-sm font-medium mb-2">
              Haul photos{" "}
              <span className="text-brand-ink/50 font-normal ml-1">
                ({heroImages.length}/{MAX_HERO_IMAGES})
              </span>
              <span className="text-brand-ink/50 font-normal ml-2 block mt-1">
                Required — JPG, PNG, WebP, or GIF. First photo becomes the hero; rest appear in a gallery on the post.
              </span>
            </label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={(e) =>
                appendFiles(
                  e.target.files,
                  heroImages,
                  setHeroImages,
                  MAX_HERO_IMAGES
                ).finally(() => {
                  e.target.value = "";
                })
              }
              disabled={heroImages.length >= MAX_HERO_IMAGES}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-brand-yellow file:text-brand-ink hover:file:bg-brand-yellow-dark file:cursor-pointer disabled:opacity-50"
            />
            {heroImages.length > 0 && (
              <ThumbnailGrid
                images={heroImages}
                onRemove={(i) => removeAt(i, heroImages, setHeroImages)}
                onMakeHero={(i) => moveToFront(i, heroImages, setHeroImages)}
                heroLabel
              />
            )}
          </div>

          <div>
            <label
              htmlFor="photo-notes"
              className="block text-sm font-medium mb-2"
            >
              What&apos;s in the photos
              <span className="text-brand-ink/50 font-normal ml-2">
                Notable items visible across the haul photos — gives Claude concrete details
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
              heroImages.length === 0 ||
              (acquisitionContext.trim().length + photoNotes.trim().length < 10 &&
                contextImages.length === 0 &&
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
                  : `Publish ${heroImages.length} photo${heroImages.length === 1 ? "" : "s"} →`}
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
                </code>{" "}
                (additional photos as <code className="bg-white px-1 rounded">-1.jpg</code>, <code className="bg-white px-1 rounded">-2.jpg</code>, etc.)
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

function ThumbnailGrid({
  images,
  onRemove,
  onMakeHero,
  onPromoteToHero,
  heroLabel,
}: {
  images: ImageData[];
  onRemove: (i: number) => void;
  /** Reorder within the hero list. Shown on non-first hero thumbnails. */
  onMakeHero?: (i: number) => void;
  /** Move a context photo into the hero list at position 0. Shown on
   *  context thumbnails when set. */
  onPromoteToHero?: (i: number) => void;
  heroLabel?: boolean;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
      {images.map((img, i) => (
        <div
          key={`${img.fileName}-${i}`}
          className="relative group border border-brand-ink/15 rounded-md overflow-hidden bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.previewUrl}
            alt={img.fileName}
            className="w-full aspect-square object-cover"
          />
          {heroLabel && i === 0 && (
            <span className="absolute top-1 left-1 bg-brand-yellow text-brand-ink text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded shadow-sm">
              Hero
            </span>
          )}
          {heroLabel && i !== 0 && onMakeHero && (
            <button
              type="button"
              onClick={() => onMakeHero(i)}
              className="absolute bottom-1 left-1 right-1 bg-brand-ink/70 hover:bg-brand-ink text-white text-[10px] uppercase tracking-wider font-medium py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Make this the hero photo"
            >
              Make hero
            </button>
          )}
          {onPromoteToHero && (
            <button
              type="button"
              onClick={() => onPromoteToHero(i)}
              className="absolute bottom-1 left-1 right-1 bg-brand-yellow hover:bg-brand-yellow-dark text-brand-ink text-[10px] uppercase tracking-wider font-medium py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Move this photo to the haul section as the displayed hero"
            >
              Use as hero →
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-1 right-1 bg-white/90 hover:bg-white text-brand-ink rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-sm leading-none"
            title="Remove"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ))}
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
inter text-brand-ink/70">
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
                </code>{" "}
                (additional photos as <code className="bg-white px-1 rounded">-1.jpg</code>, <code className="bg-white px-1 rounded">-2.jpg</code>, etc.)
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

function ThumbnailGrid({
  images,
  onRemove,
  onMakeHero,
  onPromoteToHero,
  heroLabel,
}: {
  images: ImageData[];
  onRemove: (i: number) => void;
  /** Reorder within the hero list. Shown on non-first hero thumbnails. */
  onMakeHero?: (i: number) => void;
  /** Move a context photo into the hero list at position 0. Shown on
   *  context thumbnails when set. */
  onPromoteToHero?: (i: number) => void;
  heroLabel?: boolean;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
      {images.map((img, i) => (
        <div
          key={`${img.fileName}-${i}`}
          className="relative group border border-brand-ink/15 rounded-md overflow-hidden bg-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.previewUrl}
            alt={img.fileName}
            className="w-full aspect-square object-cover"
          />
          {heroLabel && i === 0 && (
            <span className="absolute top-1 left-1 bg-brand-yellow text-brand-ink text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded shadow-sm">
              Hero
            </span>
          )}
          {heroLabel && i !== 0 && onMakeHero && (
            <button
              type="button"
              onClick={() => onMakeHero(i)}
              className="absolute bottom-1 left-1 right-1 bg-brand-ink/70 hover:bg-brand-ink text-white text-[10px] uppercase tracking-wider font-medium py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Make this the hero photo"
            >
              Make hero
            </button>
          )}
          {onPromoteToHero && (
            <button
              type="button"
              onClick={() => onPromoteToHero(i)}
              className="absolute bottom-1 left-1 right-1 bg-brand-yellow hover:bg-brand-yellow-dark text-brand-ink text-[10px] uppercase tracking-wider font-medium py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Move this photo to the haul section as the displayed hero"
            >
              Use as hero →
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-1 right-1 bg-white/90 hover:bg-white text-brand-ink rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-sm leading-none"
            title="Remove"
            aria-label="Remove image"
          >
            ×
          </button>
        </div>
      ))}
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
