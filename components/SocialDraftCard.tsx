"use client";

// Renders one channel's generated draft as a copy-able card. Knows how to
// display each output shape (text-with-hashtags, plain text, IG story,
// Pinterest title/desc/board) defined in lib/social/channel-styles.ts.

import { useState } from "react";
import {
  CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";

type AnyDraft = Record<string, unknown>;

export default function SocialDraftCard({
  channel,
  draft,
  onSave,
  isSaved,
  isSaving,
}: {
  channel: ChannelKey;
  draft: AnyDraft | undefined;
  /** If provided, render a "Save to queue" button. */
  onSave?: () => void | Promise<void>;
  isSaved?: boolean;
  isSaving?: boolean;
}) {
  const meta = CHANNELS[channel];
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(label);
        setTimeout(() => setCopied(null), 1500);
      },
      () => {
        setCopied("Copy failed");
        setTimeout(() => setCopied(null), 1500);
      }
    );
  }

  if (!draft) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-900">
        <p className="font-medium mb-1">{meta.label}</p>
        <p>Claude didn&rsquo;t return a post for this channel. Try regenerating.</p>
      </div>
    );
  }

  // Build a "full text" for the big Copy button and a character counter
  let fullText = "";
  let body: React.ReactNode = null;

  if (meta.outputKind === "text-with-hashtags") {
    const text = (draft.text as string) ?? "";
    const hashtags = Array.isArray(draft.hashtags) ? (draft.hashtags as string[]) : [];
    fullText = hashtags.length > 0 ? `${text}\n\n${hashtags.join(" ")}` : text;
    body = (
      <>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed mb-4 text-brand-ink">
          {text}
        </pre>
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((h, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 bg-brand-yellow/25 text-brand-ink rounded"
              >
                {h}
              </span>
            ))}
          </div>
        )}
      </>
    );
  } else if (meta.outputKind === "text") {
    const text = (draft.text as string) ?? "";
    fullText = text;
    body = (
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-brand-ink">
        {text}
      </pre>
    );
  } else if (meta.outputKind === "story") {
    const overlay = (draft.overlay_text as string) ?? "";
    const cta = (draft.cta as string) ?? "";
    fullText = `${overlay}\n${cta}`;
    body = (
      <div className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Overlay text
          </p>
          <p className="font-marker text-2xl text-brand-ink">{overlay}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            CTA
          </p>
          <p className="text-sm text-brand-ink/80">{cta}</p>
        </div>
      </div>
    );
  } else if (meta.outputKind === "pinterest") {
    const title = (draft.title as string) ?? "";
    const description = (draft.description as string) ?? "";
    const board = (draft.board_suggestion as string) ?? "";
    fullText = `${title}\n\n${description}\n\nBoard: ${board}`;
    body = (
      <div className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Title ({title.length} chars)
          </p>
          <p className="font-medium text-base text-brand-ink leading-snug">
            {title}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Description ({description.length} chars)
          </p>
          <p className="text-sm text-brand-ink/85 leading-relaxed">
            {description}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
            Suggested board
          </p>
          <p className="text-sm text-brand-ink/80 italic">{board}</p>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => copy(title, "title")}
            className="text-xs px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors"
          >
            {copied === "title" ? "Copied!" : "Copy title"}
          </button>
          <button
            onClick={() => copy(description, "desc")}
            className="text-xs px-3 py-1.5 border border-brand-ink/20 rounded hover:bg-brand-ink/5 transition-colors"
          >
            {copied === "desc" ? "Copied!" : "Copy description"}
          </button>
        </div>
      </div>
    );
  }

  const charCount = fullText.length;
  const overBudget = charCount > meta.charBudget;
  const overLimit = charCount > meta.charLimit;

  return (
    <div className="border border-brand-ink/15 rounded-lg p-5 bg-white">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h3 className="font-marker text-xl text-brand-ink">{meta.label}</h3>
        <span
          className={`text-xs font-medium ${
            overLimit
              ? "text-red-700"
              : overBudget
                ? "text-amber-700"
                : "text-brand-ink/50"
          }`}
          title={`Soft budget ${meta.charBudget} · platform limit ${meta.charLimit}`}
        >
          {charCount} / {meta.charBudget}
        </span>
      </div>
      <p className="text-xs text-brand-ink/55 mb-4">{meta.blurb}</p>

      {body}

      <div className="flex items-center gap-2 mt-5 pt-4 border-t border-brand-ink/10 flex-wrap">
        <button
          onClick={() => copy(fullText, "all")}
          className="inline-flex items-center px-3 py-1.5 bg-brand-yellow text-brand-ink text-sm font-medium rounded hover:bg-brand-yellow-dark transition-colors"
        >
          {copied === "all" ? "Copied!" : "Copy post"}
        </button>
        {onSave && (
          isSaved ? (
            <span className="inline-flex items-center px-3 py-1.5 text-sm text-emerald-700 font-medium">
              Saved ✓
            </span>
          ) : (
            <button
              onClick={() => void onSave()}
              disabled={isSaving}
              className="inline-flex items-center px-3 py-1.5 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save to queue"}
            </button>
          )
        )}
        {overLimit && (
          <span className="text-xs text-red-700">
            Over the platform limit by {charCount - meta.charLimit} chars.
          </span>
        )}
      </div>
    </div>
  );
}
