"use client";

// Interactive queue list. Groups drafts into Today / Upcoming / Drafts /
// Posted / Skipped, lets you schedule, edit, mark posted, and delete.

import { useMemo, useState } from "react";
import QueueDraftRow from "@/components/QueueDraftRow";
import {
  CHANNELS,
  type ChannelKey,
} from "@/lib/social/channel-styles";

export type DraftRow = {
  id: string;
  sourceType: "haul" | "item" | "sale";
  sourceId: string;
  sourceTitle: string;
  sourceImage: string | null;
  generationId: string;
  contentType: string;
  channel: string;
  content: Record<string, unknown>;
  status: "draft" | "scheduled" | "posted" | "skipped" | "failed";
  scheduledFor: string | null;
  postedAt: string | null;
  notes: string | null;
  // Phase 2D-3 auto-posting fields
  postId: string | null;
  postUrl: string | null;
  postError: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TabKey = "schedule" | "drafts" | "failed" | "posted" | "skipped";

const TAB_LABELS: Record<TabKey, string> = {
  schedule: "Scheduled",
  drafts: "Drafts",
  failed: "Failed",
  posted: "Posted",
  skipped: "Skipped",
};

export default function QueueClient({
  initialDrafts,
}: {
  initialDrafts: DraftRow[];
}) {
  const [drafts, setDrafts] = useState<DraftRow[]>(initialDrafts);
  const [tab, setTab] = useState<TabKey>("schedule");
  const [channelFilter, setChannelFilter] = useState<ChannelKey | "all">("all");
  const [error, setError] = useState<string | null>(null);

  // Counts per tab — drives the tab badges
  const counts = useMemo(() => {
    return {
      schedule: drafts.filter((d) => d.status === "scheduled").length,
      drafts: drafts.filter((d) => d.status === "draft").length,
      failed: drafts.filter((d) => d.status === "failed").length,
      posted: drafts.filter((d) => d.status === "posted").length,
      skipped: drafts.filter((d) => d.status === "skipped").length,
    };
  }, [drafts]);

  // The set of drafts for the active tab + channel filter
  const visible = useMemo(() => {
    return drafts.filter((d) => {
      if (channelFilter !== "all" && d.channel !== channelFilter) return false;
      if (tab === "schedule") return d.status === "scheduled";
      if (tab === "drafts") return d.status === "draft";
      if (tab === "failed") return d.status === "failed";
      if (tab === "posted") return d.status === "posted";
      if (tab === "skipped") return d.status === "skipped";
      return false;
    });
  }, [drafts, tab, channelFilter]);

  // For the "schedule" tab, split into Today / Upcoming / Past-due
  const scheduleBuckets = useMemo(() => {
    if (tab !== "schedule") return null;
    const now = Date.now();
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const endOfToday = today.getTime();
    const buckets = {
      pastDue: [] as DraftRow[],
      today: [] as DraftRow[],
      upcoming: [] as DraftRow[],
      unscheduled: [] as DraftRow[], // status=scheduled but somehow no scheduledFor
    };
    for (const d of visible) {
      if (!d.scheduledFor) {
        buckets.unscheduled.push(d);
        continue;
      }
      const t = new Date(d.scheduledFor).getTime();
      if (t < now) buckets.pastDue.push(d);
      else if (t <= endOfToday) buckets.today.push(d);
      else buckets.upcoming.push(d);
    }
    // Sort each bucket by scheduled time ascending
    const byTime = (a: DraftRow, b: DraftRow) =>
      new Date(a.scheduledFor ?? 0).getTime() -
      new Date(b.scheduledFor ?? 0).getTime();
    buckets.pastDue.sort(byTime);
    buckets.today.sort(byTime);
    buckets.upcoming.sort(byTime);
    return buckets;
  }, [tab, visible]);

  // Patch + refresh helpers
  async function patchDraft(
    id: string,
    body: Record<string, unknown>
  ): Promise<DraftRow | null> {
    try {
      setError(null);
      const res = await fetch(`/api/admin/social/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { draft: DraftRow };
      // Drizzle returns Dates again; normalize to strings to match DraftRow
      const normalized: DraftRow = {
        ...data.draft,
        scheduledFor: data.draft.scheduledFor
          ? new Date(data.draft.scheduledFor).toISOString()
          : null,
        postedAt: data.draft.postedAt
          ? new Date(data.draft.postedAt).toISOString()
          : null,
        createdAt: new Date(data.draft.createdAt).toISOString(),
        updatedAt: new Date(data.draft.updatedAt).toISOString(),
      };
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? normalized : d))
      );
      return normalized;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      return null;
    }
  }

  async function deleteDraft(id: string) {
    if (!confirm("Delete this draft?")) return;
    try {
      setError(null);
      const res = await fetch(`/api/admin/social/drafts/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  /** Post a draft right now. Updates row with result on success/failure. */
  async function postNow(id: string): Promise<DraftRow | null> {
    try {
      setError(null);
      const res = await fetch(`/api/admin/social/drafts/${id}/post`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draft?: DraftRow;
      };
      if (data.draft) {
        const normalized: DraftRow = {
          ...data.draft,
          scheduledFor: data.draft.scheduledFor
            ? new Date(data.draft.scheduledFor).toISOString()
            : null,
          postedAt: data.draft.postedAt
            ? new Date(data.draft.postedAt).toISOString()
            : null,
          lastAttemptAt: data.draft.lastAttemptAt
            ? new Date(data.draft.lastAttemptAt).toISOString()
            : null,
          createdAt: new Date(data.draft.createdAt).toISOString(),
          updatedAt: new Date(data.draft.updatedAt).toISOString(),
        };
        setDrafts((prev) =>
          prev.map((d) => (d.id === id ? normalized : d))
        );
        if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
        return normalized;
      }
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post failed");
      return null;
    }
  }

  const rowProps = {
    onPatch: patchDraft,
    onDelete: deleteDraft,
    onPostNow: postNow,
  };

  if (drafts.length === 0) {
    return (
      <div className="bg-brand-paper border border-brand-ink/10 rounded-lg p-8 text-center">
        <p className="text-brand-ink/70 mb-4">
          No saved drafts yet. Generate some, then click &ldquo;Save to queue&rdquo;.
        </p>
        <a
          href="/admin/social"
          className="inline-flex items-center px-5 py-2 bg-brand-yellow text-brand-ink font-medium rounded-md hover:bg-brand-yellow-dark transition-colors"
        >
          Generate social copy →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="border-b border-brand-ink/15 flex flex-wrap gap-x-1">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === k
                ? "border-brand-yellow text-brand-ink"
                : "border-transparent text-brand-ink/60 hover:text-brand-ink"
            }`}
          >
            {TAB_LABELS[k]}{" "}
            <span className="ml-1 text-xs text-brand-ink/50">
              ({counts[k]})
            </span>
          </button>
        ))}
      </div>

      {/* Channel filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs uppercase tracking-wider text-brand-ink/50 mr-1">
          Channel:
        </span>
        <button
          onClick={() => setChannelFilter("all")}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            channelFilter === "all"
              ? "bg-brand-ink text-brand-paper border-brand-ink"
              : "bg-white text-brand-ink/70 border-brand-ink/20 hover:border-brand-ink/40"
          }`}
        >
          All
        </button>
        {(Object.keys(CHANNELS) as ChannelKey[]).map((c) => (
          <button
            key={c}
            onClick={() => setChannelFilter(c)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              channelFilter === c
                ? "bg-brand-ink text-brand-paper border-brand-ink"
                : "bg-white text-brand-ink/70 border-brand-ink/20 hover:border-brand-ink/40"
            }`}
          >
            {CHANNELS[c].label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Body */}
      {tab === "schedule" && scheduleBuckets ? (
        <div className="space-y-8">
          {scheduleBuckets.pastDue.length > 0 && (
            <BucketSection
              title="Past due"
              tint="red"
              drafts={scheduleBuckets.pastDue}
              {...rowProps}
            />
          )}
          {scheduleBuckets.today.length > 0 && (
            <BucketSection
              title="Due today"
              tint="yellow"
              drafts={scheduleBuckets.today}
              {...rowProps}
            />
          )}
          {scheduleBuckets.upcoming.length > 0 && (
            <BucketSection
              title="Coming up"
              tint="plain"
              drafts={scheduleBuckets.upcoming}
              {...rowProps}
            />
          )}
          {scheduleBuckets.unscheduled.length > 0 && (
            <BucketSection
              title="Scheduled but missing a time"
              tint="plain"
              drafts={scheduleBuckets.unscheduled}
              {...rowProps}
            />
          )}
          {visible.length === 0 && (
            <p className="text-sm text-brand-ink/60 italic">
              Nothing scheduled. Open the Drafts tab to schedule something.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.length === 0 ? (
            <p className="text-sm text-brand-ink/60 italic">
              Nothing here.
            </p>
          ) : (
            visible.map((d) => (
              <QueueDraftRow key={d.id} draft={d} {...rowProps} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BucketSection({
  title,
  tint,
  drafts,
  onPatch,
  onDelete,
  onPostNow,
}: {
  title: string;
  tint: "red" | "yellow" | "plain";
  drafts: DraftRow[];
  onPatch: (id: string, body: Record<string, unknown>) => Promise<DraftRow | null>;
  onDelete: (id: string) => Promise<void>;
  onPostNow: (id: string) => Promise<DraftRow | null>;
}) {
  const tintClass =
    tint === "red"
      ? "text-red-800"
      : tint === "yellow"
        ? "text-brand-earth"
        : "text-brand-ink/70";
  return (
    <div>
      <p
        className={`text-xs uppercase tracking-wider mb-3 font-medium ${tintClass}`}
      >
        {title} ({drafts.length})
      </p>
      <div className="space-y-3">
        {drafts.map((d) => (
          <QueueDraftRow
            key={d.id}
            draft={d}
            onPatch={onPatch}
            onDelete={onDelete}
            onPostNow={onPostNow}
          />
        ))}
      </div>
    </div>
  );
}
