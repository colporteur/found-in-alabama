"use client";

// Picker + generation flow for the social copy page.
// Lets the user choose source (haul or item), channels, and content type,
// then calls /api/admin/social/generate and renders the per-channel cards.

import { useMemo, useState } from "react";
import Link from "next/link";
import SocialDraftCard from "@/components/SocialDraftCard";
import {
  CHANNELS,
  CHANNEL_ORDER,
  DEFAULT_CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";

export type HaulOption = {
  slug: string;
  title: string;
  date: string;
  hero: string | null;
};

export type ItemOption = {
  id: string;
  title: string;
  heroImage: string | null;
  price: string | null;
  haulSlug: string | null;
  capturedAt: string;
};

type SourceKind = "haul" | "item";
type ContentType = "just-listed" | "new-haul" | "throwback" | "just-sold";

type GenerateResponse = {
  drafts: Record<string, Record<string, unknown>>;
  missingChannels: string[];
  usedVision: boolean;
  generationId: string;
  contentType: ContentType;
  source: {
    sourceType: "haul" | "item";
    sourceId: string;
    sourceTitle: string;
    sourceImage: string | null;
  };
  usage?: { inputTokens: number; outputTokens: number };
};

type SavedMap = Record<string, { id: string }>;

export default function SocialGeneratorClient({
  hauls,
  items,
}: {
  hauls: HaulOption[];
  items: ItemOption[];
}) {
  const [sourceKind, setSourceKind] = useState<SourceKind>("haul");
  const [haulSlug, setHaulSlug] = useState<string>(hauls[0]?.slug ?? "");
  const [itemId, setItemId] = useState<string>(items[0]?.id ?? "");
  const [contentType, setContentType] = useState<ContentType>("new-haul");
  const [channels, setChannels] = useState<ChannelKey[]>(DEFAULT_CHANNELS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [saved, setSaved] = useState<SavedMap>({}); // channel → { id }
  const [isSavingAll, setIsSavingAll] = useState(false);

  // When user switches between haul/item, swap the default content type
  function switchSourceKind(kind: SourceKind) {
    setSourceKind(kind);
    setContentType(kind === "haul" ? "new-haul" : "just-listed");
    setResult(null);
    setSaved({});
  }

  function toggleChannel(c: ChannelKey) {
    setChannels((curr) =>
      curr.includes(c) ? curr.filter((k) => k !== c) : [...curr, c]
    );
  }

  const selectedSourceMeta = useMemo(() => {
    if (sourceKind === "haul") {
      const h = hauls.find((x) => x.slug === haulSlug);
      return h
        ? { title: h.title, hero: h.hero, subtitle: h.date }
        : null;
    }
    const it = items.find((x) => x.id === itemId);
    return it
      ? {
          title: it.title,
          hero: it.heroImage,
          subtitle: it.price ? `$${it.price}` : "",
        }
      : null;
  }, [sourceKind, haulSlug, itemId, hauls, items]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSaved({});
    if (channels.length === 0) {
      setError("Pick at least one channel.");
      return;
    }
    const sourceId = sourceKind === "haul" ? haulSlug : itemId;
    if (!sourceId) {
      setError(
        sourceKind === "haul"
          ? "No hauls available. Publish a journal post first."
          : "No items available. Capture some with the Chrome extension first."
      );
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch("/api/admin/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: sourceKind,
          sourceId,
          contentType,
          channels,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as GenerateResponse;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setIsGenerating(false);
    }
  }

  /** Save one channel's draft to the queue. Updates `saved` state. */
  async function saveOne(channel: ChannelKey) {
    if (!result) return;
    const draft = result.drafts[channel];
    if (!draft) return;
    try {
      const res = await fetch("/api/admin/social/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts: [
            {
              ...result.source,
              generationId: result.generationId,
              contentType: result.contentType,
              channel,
              content: draft,
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        saved: Array<{ id: string; channel: string }>;
      };
      setSaved((prev) => {
        const next = { ...prev };
        for (const row of data.saved) {
          next[row.channel] = { id: row.id };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  /** Save every unsaved channel in this generation. */
  async function saveAll() {
    if (!result) return;
    const unsaved = channels.filter((c) => !saved[c] && result.drafts[c]);
    if (unsaved.length === 0) return;
    setIsSavingAll(true);
    try {
      const res = await fetch("/api/admin/social/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts: unsaved.map((channel) => ({
            ...result.source,
            generationId: result.generationId,
            contentType: result.contentType,
            channel,
            content: result.drafts[channel],
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        saved: Array<{ id: string; channel: string }>;
      };
      setSaved((prev) => {
        const next = { ...prev };
        for (const row of data.saved) {
          next[row.channel] = { id: row.id };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSavingAll(false);
    }
  }

  const savedCount = Object.keys(saved).length;
  const totalDrafts = result
    ? channels.filter((c) => result.drafts[c]).length
    : 0;
  const unsavedCount = totalDrafts - savedCount;

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Quick link to the queue page */}
      <div className="flex justify-end -mb-4">
        <Link
          href="/admin/social/queue"
          className="text-sm hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
        >
          View queue →
        </Link>
      </div>

      <form onSubmit={handleGenerate} className="space-y-6">
        {/* ── Source kind toggle ─────────────────────────────────────── */}
        <div>
          <p className="text-sm font-medium mb-2">What are we posting about?</p>
          <div className="inline-flex border border-brand-ink/20 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => switchSourceKind("haul")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                sourceKind === "haul"
                  ? "bg-brand-yellow text-brand-ink"
                  : "bg-white text-brand-ink/70 hover:bg-brand-ink/5"
              }`}
            >
              A haul ({hauls.length})
            </button>
            <button
              type="button"
              onClick={() => switchSourceKind("item")}
              className={`px-4 py-2 text-sm font-medium border-l border-brand-ink/20 transition-colors ${
                sourceKind === "item"
                  ? "bg-brand-yellow text-brand-ink"
                  : "bg-white text-brand-ink/70 hover:bg-brand-ink/5"
              }`}
            >
              An item ({items.length})
            </button>
          </div>
        </div>

        {/* ── Source picker ──────────────────────────────────────────── */}
        {sourceKind === "haul" && (
          <div>
            <label
              htmlFor="haul-select"
              className="block text-sm font-medium mb-2"
            >
              Haul
            </label>
            {hauls.length === 0 ? (
              <p className="text-sm text-brand-ink/60 italic">
                No hauls yet. Publish a journal post first.
              </p>
            ) : (
              <select
                id="haul-select"
                value={haulSlug}
                onChange={(e) => {
                  setHaulSlug(e.target.value);
                  setResult(null);
                }}
                className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              >
                {hauls.map((h) => (
                  <option key={h.slug} value={h.slug}>
                    {h.date} — {h.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {sourceKind === "item" && (
          <div>
            <label
              htmlFor="item-select"
              className="block text-sm font-medium mb-2"
            >
              Item ({items.length} most-recently captured active items)
            </label>
            {items.length === 0 ? (
              <p className="text-sm text-brand-ink/60 italic">
                No items captured yet. Use the Chrome extension on your Nifty
                inventory page.
              </p>
            ) : (
              <select
                id="item-select"
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  setResult(null);
                }}
                className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.title}
                    {it.price ? ` — $${it.price}` : ""}
                    {it.haulSlug ? ` · ${it.haulSlug}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* ── Preview of selection ───────────────────────────────────── */}
        {selectedSourceMeta && (
          <div className="flex gap-4 items-center border border-brand-ink/10 bg-white rounded-md p-3">
            {selectedSourceMeta.hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selectedSourceMeta.hero}
                alt=""
                className="w-20 h-20 object-cover rounded"
              />
            ) : (
              <div className="w-20 h-20 bg-brand-paper rounded flex items-center justify-center text-xs text-brand-ink/40">
                no image
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm line-clamp-2">
                {selectedSourceMeta.title}
              </p>
              {selectedSourceMeta.subtitle && (
                <p className="text-xs text-brand-ink/60 mt-1">
                  {selectedSourceMeta.subtitle}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Content type ───────────────────────────────────────────── */}
        <div>
          <label
            htmlFor="content-type"
            className="block text-sm font-medium mb-2"
          >
            Content angle
          </label>
          <select
            id="content-type"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as ContentType)}
            className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
          >
            {sourceKind === "haul" ? (
              <>
                <option value="new-haul">New haul announcement</option>
                <option value="throwback">Throwback</option>
              </>
            ) : (
              <>
                <option value="just-listed">Just-listed</option>
                <option value="just-sold">Just-sold</option>
                <option value="throwback">Throwback</option>
              </>
            )}
          </select>
        </div>

        {/* ── Channels ───────────────────────────────────────────────── */}
        <fieldset>
          <legend className="text-sm font-medium mb-2">Channels</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {CHANNEL_ORDER.map((c) => {
              const meta = CHANNELS[c];
              const checked = channels.includes(c);
              return (
                <label
                  key={c}
                  className={`flex items-start gap-2 p-3 border rounded-md cursor-pointer transition-colors ${
                    checked
                      ? "border-brand-yellow bg-brand-yellow/10"
                      : "border-brand-ink/15 bg-white hover:border-brand-ink/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleChannel(c)}
                    className="mt-1 accent-brand-yellow"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">
                      {meta.label}
                    </span>
                    <span className="block text-xs text-brand-ink/60 mt-0.5">
                      {meta.blurb}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isGenerating || channels.length === 0}
            className="inline-flex items-center justify-center px-6 py-3 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating
              ? "Generating…"
              : `Generate ${channels.length} draft${channels.length === 1 ? "" : "s"} →`}
          </button>
          <span className="text-xs text-brand-ink/50">
            One Sonnet vision call · ~$0.02
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
            {error}
          </div>
        )}
      </form>

      {/* ── Results ──────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4 pt-6 border-t border-brand-ink/10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-marker text-2xl">Drafts</h2>
            <div className="flex flex-wrap items-center gap-3">
              {unsavedCount > 0 ? (
                <button
                  onClick={saveAll}
                  disabled={isSavingAll}
                  className="inline-flex items-center px-4 py-2 bg-brand-ink text-brand-paper text-sm font-medium rounded hover:bg-brand-ink/90 transition-colors disabled:opacity-50"
                >
                  {isSavingAll
                    ? "Saving…"
                    : `Save ${unsavedCount} to queue`}
                </button>
              ) : (
                savedCount > 0 && (
                  <span className="text-sm text-emerald-700 font-medium">
                    All saved ✓ <Link href="/admin/social/queue" className="underline decoration-brand-yellow decoration-2 underline-offset-2">View queue</Link>
                  </span>
                )
              )}
              <div className="text-xs text-brand-ink/55 flex flex-wrap gap-x-4 gap-y-1">
                {!result.usedVision && (
                  <span className="text-amber-700">
                    ⚠ No image — text-only generation
                  </span>
                )}
                {result.usage && (
                  <span>
                    {result.usage.inputTokens.toLocaleString()} in / {result.usage.outputTokens.toLocaleString()} out
                  </span>
                )}
              </div>
            </div>
          </div>

          {result.missingChannels.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-900">
              Claude didn&rsquo;t return drafts for:{" "}
              {result.missingChannels.join(", ")}. Try regenerating.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {channels.map((c) => (
              <SocialDraftCard
                key={c}
                channel={c}
                draft={result.drafts[c]}
                onSave={result.drafts[c] ? () => saveOne(c) : undefined}
                isSaved={!!saved[c]}
                isSaving={isSavingAll}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
