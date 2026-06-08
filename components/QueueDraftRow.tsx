"use client";

// One row in the social-drafts queue. Renders the source thumbnail,
// channel badge, content preview, and inline controls for scheduling,
// marking posted, editing, and deleting.

import { useState } from "react";
import {
  CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";
import type { DraftRow } from "@/app/admin/social/queue/QueueClient";

// Convert an ISO UTC string into a "YYYY-MM-DDTHH:MM" string in the
// user's local timezone, suitable for <input type="datetime-local">.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert a "YYYY-MM-DDTHH:MM" local datetime string back to a UTC ISO
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local); // browser parses as local time
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatScheduledFor(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function previewText(content: Record<string, unknown>, channel: string): string {
  // Each channel shape has a different "main text" field
  if (typeof content.text === "string") return content.text;
  if (typeof content.overlay_text === "string")
    return `"${content.overlay_text}" — ${content.cta ?? ""}`;
  if (typeof content.title === "string") return content.title;
  return JSON.stringify(content).slice(0, 200);
}

const STATUS_BADGE: Record<
  DraftRow["status"],
  { label: string; cls: string }
> = {
  draft: {
    label: "Draft",
    cls: "bg-brand-ink/10 text-brand-ink/70",
  },
  scheduled: {
    label: "Scheduled",
    cls: "bg-brand-yellow text-brand-ink",
  },
  posted: {
    label: "Posted",
    cls: "bg-emerald-100 text-emerald-800",
  },
  skipped: {
    label: "Skipped",
    cls: "bg-brand-ink/10 text-brand-ink/50 line-through",
  },
};

export default function QueueDraftRow({
  draft,
  onPatch,
  onDelete,
}: {
  draft: DraftRow;
  onPatch: (
    id: string,
    body: Record<string, unknown>
  ) => Promise<DraftRow | null>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(
    isoToLocalInput(draft.scheduledFor)
  );
  const [editingText, setEditingText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channelMeta = CHANNELS[draft.channel as ChannelKey];
  const channelLabel = channelMeta?.label ?? draft.channel;

  async function applySchedule() {
    setBusy(true);
    const iso = localInputToIso(scheduleInput);
    if (!iso) {
      setBusy(false);
      return;
    }
    await onPatch(draft.id, {
      scheduledFor: iso,
      status: "scheduled",
    });
    setBusy(false);
  }

  async function unschedule() {
    setBusy(true);
    await onPatch(draft.id, {
      scheduledFor: null,
      status: "draft",
    });
    setScheduleInput("");
    setBusy(false);
  }

  async function markPosted() {
    setBusy(true);
    await onPatch(draft.id, { status: "posted" });
    setBusy(false);
  }

  async function markSkipped() {
    setBusy(true);
    await onPatch(draft.id, { status: "skipped" });
    setBusy(false);
  }

  async function restoreToDraft() {
    setBusy(true);
    await onPatch(draft.id, { status: "draft", postedAt: null });
    setBusy(false);
  }

  async function saveEditedText() {
    if (editingText === null) return;
    setBusy(true);
    // Identify which field on the content is the editable text
    const newContent = { ...draft.content };
    if (typeof newContent.text === "string") newContent.text = editingText;
    else if (typeof newContent.overlay_text === "string")
      newContent.overlay_text = editingText;
    else if (typeof newContent.description === "string")
      newContent.description = editingText;
    await onPatch(draft.id, { content: newContent });
    setEditingText(null);
    setBusy(false);
  }

  function copy() {
    let text = "";
    if (typeof draft.content.text === "string") text = draft.content.text;
    else if (typeof draft.content.overlay_text === "string")
      text = `${draft.content.overlay_text}\n${draft.content.cta ?? ""}`;
    else if (typeof draft.content.title === "string")
      text = `${draft.content.title}\n\n${draft.content.description ?? ""}`;
    const hashtags = Array.isArray(draft.content.hashtags)
      ? (draft.content.hashtags as string[]).join(" ")
      : "";
    const full = hashtags ? `${text}\n\n${hashtags}` : text;
    navigator.clipboard.writeText(full);
  }

  const statusBadge = STATUS_BADGE[draft.status];
  const preview = previewText(draft.content, draft.channel);

  return (
    <div className="border border-brand-ink/15 rounded-lg bg-white">
      {/* Header row */}
      <div className="p-3 flex gap-3 items-start">
        {draft.sourceImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={draft.sourceImage}
            alt=""
            className="w-14 h-14 object-cover rounded shrink-0"
          />
        ) : (
          <div className="w-14 h-14 bg-brand-paper rounded shrink-0 flex items-center justify-center text-[10px] text-brand-ink/40">
            no img
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={`text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded ${statusBadge.cls}`}
            >
              {statusBadge.label}
            </span>
            <span className="text-xs uppercase tracking-wider text-brand-ink/55 font-medium">
              {channelLabel}
            </span>
            {draft.status === "scheduled" && (
              <span className="text-xs text-brand-ink/70">
                · {formatScheduledFor(draft.scheduledFor)}
              </span>
            )}
            {draft.status === "posted" && draft.postedAt && (
              <span className="text-xs text-brand-ink/55">
                · posted {formatScheduledFor(draft.postedAt)}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-brand-ink line-clamp-1">
            {draft.sourceTitle}
          </p>
          <p className="text-sm text-brand-ink/75 mt-1 line-clamp-2">
            {preview}
          </p>
        </div>
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-xs text-brand-ink/60 hover:text-brand-ink shrink-0 px-2 py-1"
        >
          {expanded ? "Collapse" : "Open"}
        </button>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-brand-ink/10 p-4 space-y-4">
          {/* Full content */}
          <div>
            <p className="text-xs uppercase tracking-wider text-brand-ink/50 mb-2">
              {channelLabel} content
            </p>
            <FullContent
              content={draft.content}
              editing={editingText !== null}
              editingText={editingText ?? ""}
              onEditingChange={setEditingText}
            />
          </div>

          {/* Inline schedule row */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs uppercase tracking-wider text-brand-ink/50 mb-1">
                Schedule for
              </label>
              <input
                type="datetime-local"
                value={scheduleInput}
                onChange={(e) => setScheduleInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-brand-ink/20 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
              />
            </div>
            <button
              type="button"
              onClick={applySchedule}
              disabled={busy || !scheduleInput}
              className="px-3 py-1.5 bg-brand-yellow text-brand-ink text-sm font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
            >
              {draft.status === "scheduled" ? "Reschedule" : "Schedule"}
            </button>
            {draft.status === "scheduled" && (
              <button
                type="button"
                onClick={unschedule}
                disabled={busy}
                className="px-3 py-1.5 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
              >
                Unschedule
              </button>
            )}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-brand-ink/10">
            <button
              type="button"
              onClick={copy}
              className="px-3 py-1.5 bg-brand-ink text-brand-paper text-sm font-medium rounded hover:bg-brand-ink/90 transition-colors"
            >
              Copy post
            </button>
            {draft.status !== "posted" ? (
              <button
                type="button"
                onClick={markPosted}
                disabled={busy}
                className="px-3 py-1.5 bg-emerald-700 text-white text-sm font-medium rounded hover:bg-emerald-800 transition-colors disabled:opacity-50"
              >
                Mark posted
              </button>
            ) : (
              <button
                type="button"
                onClick={restoreToDraft}
                disabled={busy}
                className="px-3 py-1.5 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
              >
                Unmark posted
              </button>
            )}
            {editingText !== null ? (
              <>
                <button
                  type="button"
                  onClick={saveEditedText}
                  disabled={busy}
                  className="px-3 py-1.5 bg-brand-yellow text-brand-ink text-sm font-medium rounded hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
                >
                  Save edits
                </button>
                <button
                  type="button"
                  onClick={() => setEditingText(null)}
                  className="px-3 py-1.5 bg-transparent text-brand-ink/70 border border-brand-ink/20 text-sm rounded hover:bg-brand-ink/5 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const t =
                    (draft.content.text as string | undefined) ??
                    (draft.content.overlay_text as string | undefined) ??
                    (draft.content.description as string | undefined) ??
                    "";
                  setEditingText(t);
                }}
                className="px-3 py-1.5 bg-transparent text-brand-ink border border-brand-ink/30 text-sm font-medium rounded hover:bg-brand-ink/5 transition-colors"
              >
                Edit text
              </button>
            )}
            {draft.status !== "skipped" && (
              <button
                type="button"
                onClick={markSkipped}
                disabled={busy}
                className="px-3 py-1.5 bg-transparent text-brand-ink/70 border border-brand-ink/20 text-sm font-medium rounded hover:bg-brand-ink/5 transition-colors disabled:opacity-50"
              >
                Skip
              </button>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onDelete(draft.id)}
              className="px-3 py-1.5 bg-transparent text-red-700 border border-red-200 text-sm font-medium rounded hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FullContent({
  content,
  editing,
  editingText,
  onEditingChange,
}: {
  content: Record<string, unknown>;
  editing: boolean;
  editingText: string;
  onEditingChange: (t: string) => void;
}) {
  // text + hashtags (Instagram feed)
  if (typeof content.text === "string" && Array.isArray(content.hashtags)) {
    return (
      <div className="space-y-3">
        {editing ? (
          <textarea
            value={editingText}
            onChange={(e) => onEditingChange(e.target.value)}
            rows={8}
            className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-brand-ink">
            {content.text as string}
          </pre>
        )}
        <div className="flex flex-wrap gap-1.5">
          {(content.hashtags as string[]).map((h, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 bg-brand-yellow/25 text-brand-ink rounded"
            >
              {h}
            </span>
          ))}
        </div>
      </div>
    );
  }
  // plain text
  if (typeof content.text === "string") {
    return editing ? (
      <textarea
        value={editingText}
        onChange={(e) => onEditingChange(e.target.value)}
        rows={6}
        className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
      />
    ) : (
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-brand-ink">
        {content.text as string}
      </pre>
    );
  }
  // story
  if (typeof content.overlay_text === "string") {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-brand-ink/50">Overlay</p>
        {editing ? (
          <input
            value={editingText}
            onChange={(e) => onEditingChange(e.target.value)}
            className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
          />
        ) : (
          <p className="font-marker text-xl text-brand-ink">
            {content.overlay_text as string}
          </p>
        )}
        <p className="text-xs uppercase tracking-wider text-brand-ink/50">CTA</p>
        <p className="text-sm text-brand-ink/80">{(content.cta as string) ?? ""}</p>
      </div>
    );
  }
  // Pinterest
  if (typeof content.title === "string") {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider text-brand-ink/50">Title</p>
        <p className="font-medium text-base text-brand-ink leading-snug">
          {content.title as string}
        </p>
        <p className="text-xs uppercase tracking-wider text-brand-ink/50 mt-3">
          Description
        </p>
        {editing ? (
          <textarea
            value={editingText}
            onChange={(e) => onEditingChange(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 border border-brand-ink/20 rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-yellow focus:border-brand-yellow"
          />
        ) : (
          <p className="text-sm text-brand-ink/85 leading-relaxed">
            {content.description as string}
          </p>
        )}
        <p className="text-xs uppercase tracking-wider text-brand-ink/50 mt-3">
          Board
        </p>
        <p className="text-sm text-brand-ink/80 italic">
          {(content.board_suggestion as string) ?? ""}
        </p>
      </div>
    );
  }
  return <pre className="text-xs text-brand-ink/60">{JSON.stringify(content, null, 2)}</pre>;
}
