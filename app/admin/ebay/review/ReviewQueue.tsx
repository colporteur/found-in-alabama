"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CategoryOptionDTO, SuggestionRow } from "./page";

interface Counts {
  listings: number;
  total: number;
  pending: number;
  applied: number;
  skipped: number;
  rejected: number;
}

interface GenerateBatchResult {
  ok: boolean;
  processed: number;
  remaining: number;
  hasMore: boolean;
  failures: Array<{ itemId: string; error: string }>;
  durationMs: number;
  error?: string;
}

interface DecideResult {
  ok: boolean;
  error?: string;
}

interface GenProgress {
  status: "idle" | "running" | "stopped" | "done" | "error";
  processed: number;
  remaining: number;
  totalFailures: number;
  lastBatchMs?: number;
  error?: string;
}

const INITIAL_GEN: GenProgress = {
  status: "idle",
  processed: 0,
  remaining: 0,
  totalFailures: 0,
};

type BulkDecision = "apply" | "skip" | "reject";

interface BulkProgress {
  status: "idle" | "running" | "done" | "stopped" | "error";
  decision: BulkDecision | null;
  done: number;
  total: number;
  failed: number;
  lastError?: string;
}

const INITIAL_BULK: BulkProgress = {
  status: "idle",
  decision: null,
  done: 0,
  total: 0,
  failed: 0,
};

function decodeText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

async function readJsonOrText<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  const text = await res.text();
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
}

export default function ReviewQueue({
  initialQueue,
  counts,
  categoryOptions,
}: {
  initialQueue: SuggestionRow[];
  counts: Counts;
  categoryOptions: CategoryOptionDTO[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [queue, setQueue] = useState<SuggestionRow[]>(initialQueue);
  const [gen, setGen] = useState<GenProgress>(INITIAL_GEN);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Bulk selection + bulk decision state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkProgress>(INITIAL_BULK);
  const stopBulkRef = useRef(false);

  // Re-sync local queue when the server data refreshes (after a generate
  // batch or decision). Also clear selections that no longer reference
  // visible rows.
  useEffect(() => {
    setQueue(initialQueue);
    setSelected((prev) => {
      const visible = new Set(initialQueue.map((r) => r.suggestionId));
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      return next;
    });
  }, [initialQueue]);

  // Sort categories: Alabama-flagged first, then alphabetical.
  const sortedCategoryOptions = useMemo(
    () =>
      [...categoryOptions].sort((a, b) => {
        if (a.isAlabama !== b.isAlabama) return a.isAlabama ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [categoryOptions]
  );

  // Coverage % — how much of the 883 cached listings has had a suggestion
  // generated, regardless of decision.
  const coveragePct =
    counts.listings > 0
      ? Math.round((counts.total / counts.listings) * 100)
      : 0;

  async function runGenerate() {
    stopRef.current = false;
    setGen({ ...INITIAL_GEN, status: "running" });
    let processed = 0;
    let totalFailures = 0;
    let remaining = 0;

    while (!stopRef.current) {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/admin/ebay/suggestions/generate-next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 3 }),
        });
        const json = await readJsonOrText<GenerateBatchResult>(res);
        if (!json.ok) {
          setGen({
            status: "error",
            processed,
            remaining,
            totalFailures,
            error: json.error ?? `HTTP ${res.status}`,
            lastBatchMs: Date.now() - t0,
          });
          return;
        }

        processed += json.processed;
        totalFailures += json.failures.length;
        remaining = json.remaining;

        setGen({
          status: "running",
          processed,
          remaining,
          totalFailures,
          lastBatchMs: Date.now() - t0,
        });

        // Refresh after every batch so the queue fills as we go.
        startTransition(() => router.refresh());

        if (!json.hasMore) {
          setGen({
            status: "done",
            processed,
            remaining,
            totalFailures,
            lastBatchMs: Date.now() - t0,
          });
          return;
        }
      } catch (err) {
        setGen({
          status: "error",
          processed,
          remaining,
          totalFailures,
          error: (err as Error).message,
        });
        return;
      }
    }

    setGen((prev) => ({ ...prev, status: "stopped" }));
  }

  function stopGenerate() {
    stopRef.current = true;
  }

  async function decide(
    suggestionId: string,
    decision: "apply" | "skip" | "reject",
    overrides?: { cat1Id?: string; cat2Id?: string | null }
  ) {
    setDecidingId(suggestionId);
    try {
      const body: Record<string, unknown> = { suggestionId, decision };
      if (overrides?.cat1Id !== undefined) body.overrideCategory1Id = overrides.cat1Id;
      if (overrides?.cat2Id !== undefined) body.overrideCategory2Id = overrides.cat2Id;
      const res = await fetch("/api/admin/ebay/suggestions/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readJsonOrText<DecideResult>(res);
      if (!json.ok) {
        alert(`Failed: ${json.error ?? "unknown"}`);
        return;
      }
      // Optimistically remove this row from the queue
      setQueue((prev) => prev.filter((q) => q.suggestionId !== suggestionId));
      // Refresh server state so counts update
      startTransition(() => router.refresh());
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    } finally {
      setDecidingId(null);
    }
  }

  // ── Bulk selection helpers ──────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectIds(ids: string[]) {
    setSelected(new Set(ids));
  }

  // ── Bulk decision (sequential — each ReviseItem is real) ────────────────

  async function runBulk(decision: BulkDecision) {
    if (selected.size === 0) return;
    if (
      decision === "apply" &&
      !confirm(
        `Approve & push ${selected.size} suggestion${
          selected.size === 1 ? "" : "s"
        } to eBay? This makes real changes to your live listings.`
      )
    ) {
      return;
    }
    stopBulkRef.current = false;
    const ids = Array.from(selected);
    setBulk({
      status: "running",
      decision,
      done: 0,
      total: ids.length,
      failed: 0,
    });

    let done = 0;
    let failed = 0;
    let lastError: string | undefined;

    for (const id of ids) {
      if (stopBulkRef.current) {
        setBulk({
          status: "stopped",
          decision,
          done,
          total: ids.length,
          failed,
          lastError,
        });
        startTransition(() => router.refresh());
        return;
      }
      try {
        const res = await fetch("/api/admin/ebay/suggestions/decide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggestionId: id, decision }),
        });
        const json = await readJsonOrText<DecideResult>(res);
        if (!json.ok) {
          failed++;
          lastError = json.error ?? `HTTP ${res.status}`;
        } else {
          // Optimistically remove this row + selection.
          setQueue((q) => q.filter((row) => row.suggestionId !== id));
          setSelected((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        }
      } catch (err) {
        failed++;
        lastError = (err as Error).message;
      }
      done++;
      setBulk((prev) => ({ ...prev, done, failed, lastError }));
    }

    setBulk({
      status: "done",
      decision,
      done,
      total: ids.length,
      failed,
      lastError,
    });
    startTransition(() => router.refresh());
  }

  function stopBulk() {
    stopBulkRef.current = true;
  }

  // ── Selection presets ───────────────────────────────────────────────────

  const visibleIds = useMemo(() => queue.map((q) => q.suggestionId), [queue]);
  const cat2EmptyIds = useMemo(
    () => queue.filter((q) => !q.suggestedCategory2Id).map((q) => q.suggestionId),
    [queue]
  );

  // User-adjustable confidence threshold. Persisted to localStorage so the
  // setting survives page reloads. Default 85% — a useful starting point
  // for "obvious" matches.
  const [confidencePct, setConfidencePct] = useState<number>(85);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("review:confidencePct");
    if (saved) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 0 && n <= 100) setConfidencePct(n);
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("review:confidencePct", String(confidencePct));
  }, [confidencePct]);

  const confidenceMatchingIds = useMemo(
    () =>
      queue
        .filter((q) => q.confidence * 100 >= confidencePct)
        .map((q) => q.suggestionId),
    [queue, confidencePct]
  );

  return (
    <div className="space-y-6">
      {/* Generation card */}
      <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div>
            <h2 className="font-medium text-lg">Generate suggestions</h2>
            <p className="text-sm text-brand-ink/70 mt-1">
              Coverage: {counts.total.toLocaleString()} of{" "}
              {counts.listings.toLocaleString()} listings ({coveragePct}%)
            </p>
          </div>
          {gen.status === "running" ? (
            <button
              type="button"
              onClick={stopGenerate}
              className="bg-brand-ink/10 text-brand-ink text-sm px-4 py-2 rounded hover:bg-brand-ink/20"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={runGenerate}
              disabled={counts.listings === 0 || counts.total >= counts.listings}
              className="bg-brand-ink text-brand-paper text-sm px-4 py-2 rounded hover:bg-brand-ink/90 disabled:opacity-50"
            >
              {counts.total === 0
                ? "Generate suggestions"
                : counts.total >= counts.listings
                ? "All caught up"
                : "Generate more"}
            </button>
          )}
        </div>
        <p className="text-xs text-brand-ink/50">
          Each batch sends 3 listings to Claude (Haiku). Per-listing cost
          ~$0.001. Pause and resume any time.
        </p>

        {gen.status !== "idle" && (
          <div className="mt-3 text-sm">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-brand-ink/70">
                Processed {gen.processed} this session ·{" "}
                {gen.remaining.toLocaleString()} remaining
                {gen.totalFailures
                  ? ` · ${gen.totalFailures} failed`
                  : ""}
              </span>
              {gen.lastBatchMs && (
                <span className="text-xs text-brand-ink/50">
                  {gen.lastBatchMs}ms last batch
                </span>
              )}
            </div>
            {gen.status === "done" && (
              <div className="border-l-4 border-brand-yellow bg-brand-yellow/10 p-2 text-xs">
                ✅ Done. Review the queue below.
              </div>
            )}
            {gen.status === "stopped" && (
              <div className="border-l-4 border-brand-ink/30 bg-brand-paper p-2 text-xs">
                ⏸ Stopped. Click Generate more to resume.
              </div>
            )}
            {gen.status === "error" && (
              <div className="border-l-4 border-red-500 bg-red-50 p-2 text-xs">
                ❌ {gen.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status counts */}
      <div className="grid gap-3 sm:grid-cols-4 text-sm">
        <Pill label="Pending" value={counts.pending} tone="yellow" />
        <Pill label="Applied" value={counts.applied} tone="green" />
        <Pill label="Skipped" value={counts.skipped} tone="gray" />
        <Pill label="Rejected" value={counts.rejected} tone="red" />
      </div>

      {/* Bulk selection toolbar */}
      {queue.length > 0 && (
        <div className="bg-white border border-brand-ink/15 rounded-lg p-4 sticky top-0 z-10 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-brand-ink/60 font-medium uppercase tracking-wider">
              Select
            </span>
            <PresetButton
              onClick={() => selectIds(visibleIds)}
              active={selected.size === visibleIds.length && visibleIds.length > 0}
            >
              All visible ({visibleIds.length})
            </PresetButton>
            <span className="inline-flex items-stretch rounded overflow-hidden border border-brand-ink/15">
              <span className="inline-flex items-center bg-brand-paper px-1.5 text-brand-ink/60">
                ≥
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={confidencePct}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    setConfidencePct(Math.max(0, Math.min(100, Math.round(n))));
                  }
                }}
                aria-label="Confidence threshold percent"
                className="w-12 text-xs text-center bg-brand-paper focus:outline-none focus:bg-white border-x border-brand-ink/10"
              />
              <span className="inline-flex items-center bg-brand-paper px-1.5 text-brand-ink/60">
                %
              </span>
              <button
                type="button"
                onClick={() => selectIds(confidenceMatchingIds)}
                className="px-2.5 py-1 uppercase tracking-wider bg-brand-paper text-brand-ink/70 hover:bg-brand-ink/5"
              >
                conf ({confidenceMatchingIds.length})
              </button>
            </span>
            <PresetButton
              onClick={() => selectIds(cat2EmptyIds)}
              active={false}
            >
              Slot 2 = empty ({cat2EmptyIds.length})
            </PresetButton>
            <PresetButton
              onClick={() => selectIds(visibleIds.slice(0, 10))}
              active={false}
            >
              First 10
            </PresetButton>
            <PresetButton onClick={() => selectIds([])} active={selected.size === 0}>
              None
            </PresetButton>

            <span className="ml-auto text-brand-ink/60">
              {selected.size} selected
            </span>

            {bulk.status === "running" ? (
              <button
                type="button"
                onClick={stopBulk}
                className="bg-brand-ink/10 text-brand-ink px-3 py-1.5 rounded hover:bg-brand-ink/20"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => runBulk("apply")}
                  className="bg-brand-ink text-brand-paper px-3 py-1.5 rounded hover:bg-brand-ink/90 disabled:opacity-40"
                >
                  Approve {selected.size}
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => runBulk("skip")}
                  className="bg-brand-paper text-brand-ink/70 border border-brand-ink/15 px-3 py-1.5 rounded hover:bg-brand-ink/5 disabled:opacity-40"
                >
                  Skip {selected.size}
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => runBulk("reject")}
                  className="text-red-700 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 disabled:opacity-40"
                >
                  Reject {selected.size}
                </button>
              </>
            )}
          </div>

          {bulk.status !== "idle" && bulk.decision && (
            <div className="mt-3 text-xs">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-brand-ink/70">
                  {bulk.status === "running"
                    ? `${
                        bulk.decision === "apply"
                          ? "Approving"
                          : bulk.decision === "skip"
                          ? "Skipping"
                          : "Rejecting"
                      }… ${bulk.done} of ${bulk.total}`
                    : bulk.status === "done"
                    ? `✅ ${bulk.decision === "apply" ? "Approved" : bulk.decision === "skip" ? "Skipped" : "Rejected"} ${bulk.done - bulk.failed} of ${bulk.total}`
                    : bulk.status === "stopped"
                    ? `⏸ Stopped at ${bulk.done} of ${bulk.total}`
                    : ""}
                  {bulk.failed > 0 ? ` · ${bulk.failed} failed` : ""}
                </span>
              </div>
              {bulk.total > 0 && (
                <div className="h-1.5 bg-brand-paper rounded overflow-hidden border border-brand-ink/10">
                  <div
                    className="h-full bg-brand-yellow transition-[width] duration-300"
                    style={{
                      width: `${Math.round((bulk.done / bulk.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {bulk.lastError && (
                <p className="text-red-700 mt-1 break-words">
                  Last error: {bulk.lastError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Queue */}
      {queue.length === 0 ? (
        <div className="bg-white border border-dashed border-brand-ink/20 rounded-lg p-12 text-center">
          <p className="font-marker text-2xl text-brand-ink/40 mb-1">
            {counts.total === 0
              ? "No suggestions yet"
              : counts.pending === 0
              ? "Queue is empty"
              : "Loading…"}
          </p>
          <p className="text-sm text-brand-ink/60 max-w-md mx-auto">
            {counts.total === 0
              ? "Click Generate suggestions above to get started."
              : counts.pending === 0
              ? "Every suggestion has been decided. Generate more or check the History page once it exists."
              : ""}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((row) => (
            <SuggestionCard
              key={row.suggestionId}
              row={row}
              busy={decidingId === row.suggestionId || bulk.status === "running"}
              categories={sortedCategoryOptions}
              onDecide={decide}
              selected={selected.has(row.suggestionId)}
              onToggleSelect={() => toggleSelect(row.suggestionId)}
            />
          ))}
        </ul>
      )}

      {queue.length > 0 && (
        <p className="text-xs text-brand-ink/50">
          Showing {queue.length} pending suggestions, sorted highest
          confidence first.
        </p>
      )}
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "yellow" | "green" | "gray" | "red";
}) {
  const cls =
    tone === "yellow"
      ? "bg-brand-yellow/30 text-brand-ink"
      : tone === "green"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "red"
      ? "bg-red-100 text-red-900"
      : "bg-brand-ink/10 text-brand-ink/70";
  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-4 flex items-center justify-between">
      <span className="text-xs uppercase tracking-wider text-brand-ink/50">
        {label}
      </span>
      <span
        className={`px-3 py-1 rounded font-marker text-lg ${cls}`}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function SuggestionCard({
  row,
  busy,
  categories,
  onDecide,
  selected,
  onToggleSelect,
}: {
  row: SuggestionRow;
  busy: boolean;
  categories: CategoryOptionDTO[];
  onDecide: (
    id: string,
    decision: "apply" | "skip" | "reject",
    overrides?: { cat1Id?: string; cat2Id?: string | null }
  ) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editCat1, setEditCat1] = useState<string>(
    row.suggestedCategory1Id ?? ""
  );
  const [editCat2, setEditCat2] = useState<string>(
    row.suggestedCategory2Id ?? ""
  );

  const confidenceColor =
    row.confidence >= 0.85
      ? "bg-emerald-100 text-emerald-900"
      : row.confidence >= 0.6
      ? "bg-brand-yellow/40 text-brand-ink"
      : "bg-red-100 text-red-900";

  const title = decodeText(row.title);

  return (
    <li
      className={`bg-white border rounded-lg p-4 sm:p-5 transition-colors ${
        selected ? "border-brand-yellow ring-1 ring-brand-yellow" : "border-brand-ink/15"
      }`}
    >
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex sm:flex-col items-start gap-3 sm:gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label="Select this suggestion"
            className="h-5 w-5 mt-1 accent-brand-yellow cursor-pointer"
          />
        </div>
        {row.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.primaryImageUrl}
            alt=""
            className="w-full sm:w-32 h-48 sm:h-32 object-cover rounded border border-brand-ink/10"
          />
        ) : (
          <div className="w-full sm:w-32 h-48 sm:h-32 rounded bg-brand-paper border border-dashed border-brand-ink/20" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <a
              href={row.ebayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline decoration-brand-yellow decoration-2 underline-offset-2 line-clamp-2"
              title={title}
            >
              {title}
            </a>
            <span
              className={`text-xs uppercase tracking-wider px-2 py-1 rounded shrink-0 ${confidenceColor}`}
            >
              {Math.round(row.confidence * 100)}%
            </span>
          </div>

          <div className="text-xs text-brand-ink/50 mb-3 flex flex-wrap gap-x-3 gap-y-1">
            <span>#{row.itemId}</span>
            {row.price && <span>${row.price}</span>}
          </div>

          {!editing ? (
            <div className="space-y-2 text-sm">
              <SlotChange
                label="Slot 1"
                from={row.currentCategory1Name ?? row.currentCategory1Id ?? "—"}
                to={row.suggestedCategory1Name ?? "(no fit found)"}
                isChange={
                  !!row.suggestedCategory1Id &&
                  row.suggestedCategory1Id !== row.currentCategory1Id
                }
              />
              <SlotChange
                label="Slot 2"
                from="(empty)"
                to={row.suggestedCategory2Name ?? "(leave empty)"}
                isChange={!!row.suggestedCategory2Id}
              />
              {row.reasoning && (
                <p className="text-xs text-brand-ink/60 italic pt-1">
                  &ldquo;{row.reasoning}&rdquo;
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <label className="text-brand-ink/60 min-w-[6rem]">
                  Category 1:
                </label>
                <CategorySelect
                  value={editCat1}
                  options={categories}
                  onChange={setEditCat1}
                />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <label className="text-brand-ink/60 min-w-[6rem]">
                  Category 2:
                </label>
                <CategorySelect
                  value={editCat2}
                  options={categories}
                  onChange={setEditCat2}
                  allowEmpty
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {!editing ? (
              <>
                <button
                  type="button"
                  disabled={busy || !row.suggestedCategory1Id}
                  onClick={() => onDecide(row.suggestionId, "apply")}
                  className="text-sm bg-brand-ink text-brand-paper px-3 py-1.5 rounded hover:bg-brand-ink/90 disabled:opacity-50"
                >
                  {busy ? "Applying…" : "Approve & push"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                  className="text-sm bg-brand-paper text-brand-ink border border-brand-ink/15 px-3 py-1.5 rounded hover:bg-brand-ink/5 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(row.suggestionId, "skip")}
                  className="text-sm bg-brand-paper text-brand-ink/70 border border-brand-ink/15 px-3 py-1.5 rounded hover:bg-brand-ink/5 disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(row.suggestionId, "reject")}
                  className="text-sm text-red-700 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={busy || !editCat1}
                  onClick={() =>
                    onDecide(row.suggestionId, "apply", {
                      cat1Id: editCat1,
                      cat2Id: editCat2 || null,
                    })
                  }
                  className="text-sm bg-brand-ink text-brand-paper px-3 py-1.5 rounded hover:bg-brand-ink/90 disabled:opacity-50"
                >
                  {busy ? "Applying…" : "Save & push"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                  className="text-sm bg-brand-paper text-brand-ink/70 border border-brand-ink/15 px-3 py-1.5 rounded hover:bg-brand-ink/5"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function PresetButton({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded uppercase tracking-wider transition-colors ${
        active
          ? "bg-brand-ink text-brand-paper"
          : "bg-brand-paper text-brand-ink/70 hover:bg-brand-ink/5 border border-brand-ink/15"
      }`}
    >
      {children}
    </button>
  );
}

function SlotChange({
  label,
  from,
  to,
  isChange,
}: {
  label: string;
  from: string;
  to: string;
  isChange: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-xs uppercase tracking-wider text-brand-ink/50 min-w-[3.5rem]">
        {label}
      </span>
      <span className="text-brand-ink/60">{from}</span>
      <span className="text-brand-ink/40">→</span>
      <span
        className={
          isChange
            ? "font-medium text-brand-ink"
            : "text-brand-ink/50 italic"
        }
      >
        {to}
      </span>
    </div>
  );
}

function CategorySelect({
  value,
  options,
  onChange,
  allowEmpty,
}: {
  value: string;
  options: CategoryOptionDTO[];
  onChange: (v: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 text-sm border border-brand-ink/15 rounded px-2 py-1 bg-brand-paper focus:outline-none focus:border-brand-yellow"
    >
      {allowEmpty && <option value="">(none)</option>}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.isAlabama ? "[AL] " : ""}
          {c.name}
        </option>
      ))}
    </select>
  );
}
