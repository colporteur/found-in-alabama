"use client";

// The Lot Builder board for one sort session. Top to bottom: what needs Todd
// (pieces Claude says to PULL and sell alone, pieces that NEED A PHOTO), the
// lots (numbers are the physical piles), pieces not placed yet, what's
// already built or sent on, and the sorting guide (also the print view).
// Tick pieces, then use the bar to move them; anything Todd places is locked
// so Claude's later passes leave it alone. Photos can be added to any piece.
//
// A Preview session (build.mode === "preview") uses the same board for a mixed
// batch: a report strip on top (pieces and value per pile), two more piles
// (lot pool, discard), and one "Apply preview" button that sends every pile on.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Build, BuildLot, BuildPiece, LeftoverSession } from "@/lib/listings/lot-build";
import { previewSummary, sortingGuide, PREVIEW_DISCARD_MAX, PREVIEW_SINGLE_MIN, type GuideRow } from "@/lib/listings/lot-build-plan";
import { downsize, sha256 } from "../../photoPrep";

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const BTN = "text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
const BTN_DARK = "text-sm px-3 py-1.5 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-40";

type Ctx = {
  busy: boolean;
  picked: Set<number>;
  toggle: (n: number) => void;
  addPhotos: (p: BuildPiece, files: FileList | null) => void;
  setBack: (p: BuildPiece, matters: boolean) => void;
};

function Tile({ p, ctx }: { p: BuildPiece; ctx: Ctx }) {
  const live = p.state === "sorting";
  const on = ctx.picked.has(p.n);
  const tone =
    p.verdict === "pull" || p.state === "pulled"
      ? "border-red-700"
      : p.verdict === "need_photo" && live
        ? "border-amber-600"
        : p.verdict === "pool" || p.state === "pooled"
          ? "border-teal-700"
          : p.verdict === "discard" || p.state === "discarded"
            ? "border-stone-500"
            : on
              ? "border-green-800"
              : "border-brand-ink/15";
  return (
    <div className={`w-40 rounded border-2 bg-white p-1.5 text-xs ${tone} ${on ? "ring-2 ring-green-800/40" : ""}`}>
      <button type="button" disabled={!live} onClick={() => ctx.toggle(p.n)} className="relative block w-full" title={live ? "Tick to move" : undefined}>
        {p.front ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.front} alt="" loading="lazy" className="h-36 w-full rounded object-contain bg-brand-ink/5" />
        ) : (
          <span className="block h-36 w-full rounded bg-brand-ink/5" />
        )}
        <span className="absolute left-1 top-1 rounded-full bg-brand-ink/85 px-2 py-0.5 text-sm font-bold text-white">{p.n}</span>
        {on && <span className="absolute right-1 top-1 rounded bg-green-800 px-1.5 py-0.5 font-bold text-white">✓</span>}
        {p.photos.length > 1 && <span className="absolute bottom-1 right-1 rounded bg-white/90 px-1">{p.photos.length} photos</span>}
      </button>
      <p className="mt-1 line-clamp-3 min-h-[2.5rem] font-medium" title={p.identification ?? undefined}>
        {p.identification ?? <span className="font-normal text-brand-ink/50">not identified yet</span>}
      </p>
      <p className="text-brand-ink/60">
        alone {money(p.estValue)}
        {p.locked && <span title="You placed this; Claude leaves it alone"> · 🔒</span>}
      </p>
      {p.verdict === "pull" && p.reason && <p className="mt-1 rounded bg-red-50 p-1 text-red-900">{p.reason}</p>}
      {p.verdict === "pool" && p.reason && <p className="mt-1 rounded bg-teal-50 p-1 text-teal-900">{p.reason}</p>}
      {p.verdict === "discard" && p.reason && <p className="mt-1 rounded bg-stone-100 p-1 text-stone-800">{p.reason}</p>}
      {p.verdict === "need_photo" && live && <p className="mt-1 rounded bg-amber-50 p-1 text-amber-900">Photo wanted: {p.photoRequest ?? "another photo"}</p>}
      {p.back && (
        <div className="mt-1 flex items-center gap-1.5 rounded bg-brand-ink/5 p-1">
          <a href={p.back} target="_blank" rel="noreferrer" title="Open the back scan">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.back} alt="back" loading="lazy" className="h-10 w-10 rounded bg-white object-contain" />
          </a>
          {live ? (
            <button
              type="button"
              disabled={ctx.busy}
              onClick={() => ctx.setBack(p, !p.backMatters)}
              className={`rounded px-1.5 py-0.5 text-left ${p.backMatters ? "bg-indigo-700 font-bold text-white" : "border border-brand-ink/20"}`}
              title={p.backMatters ? "This back is listed in the lot's photos. Click to treat it as a plain back." : "Plain back: one representative back stands for these in a lot. Click if this back has writing a buyer should see."}
            >
              {p.backMatters ? "Back matters ✓" : "Plain back"}
            </button>
          ) : (
            <span>{p.backMatters ? "Back listed" : "Plain back"}</span>
          )}
        </div>
      )}
      {p.back && p.backMatters && p.backNote && <p className="mt-1 rounded bg-indigo-50 p-1 text-indigo-900">{p.backNote}</p>}
      {p.origin && (
        <p className="mt-1 rounded bg-teal-50 p-1 text-teal-900" title="A leftover carried over from an earlier session: fetch it from that wave's leftover pile">
          From {p.origin.name} #{p.origin.n}
        </p>
      )}
      {p.needsLook && p.lookedAt && <p className="mt-1 rounded bg-sky-50 p-1 text-sky-900">New photo — waiting for Claude&rsquo;s second look</p>}
      {live && (
        <div className="mt-1 flex items-center justify-between gap-1">
          <label className={`cursor-pointer underline ${ctx.busy ? "pointer-events-none opacity-50" : ""}`}>
            + photo
            <input type="file" accept="image/*" multiple className="hidden" disabled={ctx.busy} onChange={(e) => ctx.addPhotos(p, e.target.files)} />
          </label>
          <Link href={`/admin/listings/${p.draftId}`} className="underline text-brand-ink/60">
            open
          </Link>
        </div>
      )}
    </div>
  );
}

/** One leftover from another session: choose one of THIS session's unbuilt
 *  lots (or "not in a lot yet") and add it in one step. */
function LeftoverRow({
  p,
  lots,
  busy,
  onAdd,
}: {
  p: LeftoverSession["pieces"][number];
  lots: BuildLot[];
  busy: boolean;
  onAdd: (lotNo: number | null) => void;
}) {
  const [to, setTo] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-2 rounded bg-white/70 p-1.5">
      {p.front ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.front} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded bg-brand-ink/5 object-contain" />
      ) : (
        <span className="h-12 w-12 shrink-0 rounded bg-brand-ink/5" />
      )}
      <span className="min-w-0 flex-1">
        <b>#{p.n}</b> {p.identification ?? "not identified"}
        {p.estValue != null && <span className="text-teal-900/70"> · alone ${p.estValue.toFixed(2)}</span>}
      </span>
      <select className="max-w-xs rounded border border-brand-ink/30 px-2 py-1" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Add to…</option>
        {lots.map((l) => (
          <option key={l.no} value={String(l.no)}>
            Lot {l.no} — {l.name} ({l.pieces.length})
          </option>
        ))}
        <option value="none">This session, not in a lot yet</option>
      </select>
      <button className={`${BTN} bg-white`} disabled={busy || !to} onClick={() => onAdd(to === "none" ? null : Number(to))}>
        Add
      </button>
    </li>
  );
}

/** "Lot 3" / "PULL" / "PHOTO" — the pile, short enough to read at arm's length. */
function whereShort(r: GuideRow, lotNo: number | null): string {
  if (r.kind === "pull") return "PULL — sell alone";
  if (r.kind === "photo") return "NEEDS PHOTO — set aside";
  if (r.kind === "pool") return "LOT POOL bin";
  if (r.kind === "discard") return "DISCARD";
  if (r.kind === "none") return "Not placed yet";
  return lotNo != null ? `Lot ${lotNo}${r.kind === "done" ? " (built)" : ""}` : r.where;
}
function whereTone(r: GuideRow): string {
  if (r.kind === "pull") return "bg-red-700 text-white";
  if (r.kind === "photo") return "bg-amber-600 text-white";
  if (r.kind === "pool") return "bg-teal-700 text-white";
  if (r.kind === "discard") return "bg-stone-600 text-white";
  if (r.kind === "none") return "bg-brand-ink/10 text-brand-ink/70";
  if (r.kind === "done") return "bg-green-800 text-white";
  return "bg-purple-800 text-white";
}

export function BuildBoard({ build, others = [], leftovers = [] }: { build: Build; others?: Array<{ id: string; name: string }>; leftovers?: LeftoverSession[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState("");
  const [newLot, setNewLot] = useState("");
  // "Sort the stack": the pieces in pile order (either direction), each with
  // where it goes. Ticks for "placed" are kept in this browser only.
  const [view, setView] = useState<"lots" | "sort">("lots");
  const [desc, setDesc] = useState(false);
  const [placed, setPlaced] = useState<Set<number>>(new Set());
  const placedKey = `lot-builder-placed-${build.id}`;
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(placedKey);
      if (raw) setPlaced(new Set((JSON.parse(raw) as unknown[]).map(Number).filter(Number.isInteger)));
    } catch {
      /* no storage: ticks last until the page is closed */
    }
  }, [placedKey]);
  function savePlaced(next: Set<number>) {
    setPlaced(next);
    try {
      window.localStorage.setItem(placedKey, JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
  }

  const preview = build.mode === "preview";
  const what = preview ? "Preview" : "Lot Builder";
  const live = build.pieces.filter((p) => p.state === "sorting");
  const pulls = live.filter((p) => p.verdict === "pull");
  const needPhoto = live.filter((p) => p.verdict === "need_photo");
  const pools = live.filter((p) => p.verdict === "pool");
  const discards = live.filter((p) => p.verdict === "discard");
  const pooledDone = build.pieces.filter((p) => p.state === "pooled");
  const discardedDone = build.pieces.filter((p) => p.state === "discarded");
  const report = useMemo(() => previewSummary(build.pieces), [build.pieces]);
  const proposed = build.lots.filter((l) => l.status === "proposed");
  const built = build.lots.filter((l) => l.status === "built");
  const unplaced = live.filter((p) => p.lotNo == null && p.verdict !== "pull" && p.verdict !== "need_photo" && p.verdict !== "pool" && p.verdict !== "discard");
  const waiting = live.filter((p) => p.needsLook);
  const sent = build.pieces.filter((p) => p.state === "pulled");
  const byN = useMemo(() => new Map(build.pieces.map((p) => [p.n, p])), [build.pieces]);
  const guide = useMemo(() => sortingGuide(build.pieces, new Map(build.lots.map((l) => [l.no, l.name]))), [build.pieces, build.lots]);
  const ordered = useMemo(() => (desc ? [...guide].reverse() : guide), [guide, desc]);
  const nextUp = ordered.find((r) => !placed.has(r.n))?.n ?? null;

  function toggle(n: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  async function act(body: Record<string, unknown>, done?: (out: Record<string, unknown>) => string | null, keepPicked = false) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/listings/lot-builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: build.id, ...body }),
      });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(out.error ?? `HTTP ${res.status}`));
      const text = done ? done(out) : null;
      if (text) setMsg({ ok: true, text });
      if (!keepPicked) setPicked(new Set());
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Same steps as "Add photos" on a draft page: register, upload through the app, confirm.
  async function addPhotos(p: BuildPiece, list: FileList | null) {
    const files = Array.from(list ?? [])
      .filter((f) => /^image\//.test(f.type))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const prepared: { blob: Blob; sha: string; name: string }[] = [];
      for (const f of files) {
        const blob = await downsize(f);
        prepared.push({ blob, sha: await sha256(blob), name: f.name });
      }
      const res = await fetch(`/api/admin/listings/${p.draftId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: prepared.map((x) => ({ name: x.name, sha256: x.sha, bytes: x.blob.size, contentType: "image/jpeg" })) }),
      });
      const out = (await res.json().catch(() => ({}))) as { uploads?: { position: number; url: string; name: string }[]; error?: string };
      if (!res.ok || !out.uploads) throw new Error(out.error ?? `HTTP ${res.status}`);
      const byName = new Map(prepared.map((x) => [x.name.slice(0, 200), x]));
      for (const [i, u] of out.uploads.entries()) {
        const x = byName.get(u.name) ?? prepared[i];
        if (!x) continue;
        const r = await fetch(u.url, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: x.blob });
        if (!r.ok) throw new Error(`Photo ${u.position}: HTTP ${r.status}`);
      }
      await fetch(`/api/admin/listings/${p.draftId}/complete`, { method: "POST" });
      setMsg({ ok: true, text: `Added ${prepared.length} photo${prepared.length === 1 ? "" : "s"} to #${p.n}. Claude looks at it again next time it works this session.` });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: `#${p.n}: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const setBack = (p: BuildPiece, matters: boolean) => act({ action: "back", pieces: [p.n], matters }, undefined, true);
  const ctx: Ctx = { busy, picked, toggle, addPhotos, setBack };
  const sel = Array.from(picked).sort((a, b) => a - b);
  const tiles = (ns: number[]) => (
    <div className="flex flex-wrap gap-2">
      {ns.map((n) => byN.get(n)).filter((p): p is BuildPiece => !!p).map((p) => <Tile key={p.n} p={p} ctx={ctx} />)}
    </div>
  );

  function move() {
    if (!sel.length) return;
    if (target === "new") {
      if (!newLot.trim()) return setMsg({ ok: false, text: "Name the new lot." });
      act({ action: "place", pieces: sel, newLot }, (o) => `Moved ${sel.length} into new lot ${String(o.lotNo)}.`);
      setNewLot("");
    } else if (target === "pull") act({ action: "place", pieces: sel, verdict: "pull" }, () => (preview ? `Marked ${sel.length} for an individual listing.` : `Marked ${sel.length} to pull.`));
    else if (target === "pool") act({ action: "place", pieces: sel, verdict: "pool" }, () => `Marked ${sel.length} for the lot pool.`);
    else if (target === "discard") act({ action: "place", pieces: sel, verdict: "discard" }, () => `Marked ${sel.length} to discard. Nothing is discarded until you apply the preview.`);
    else if (target === "need_photo") act({ action: "place", pieces: sel, verdict: "need_photo" }, () => `Marked ${sel.length} as needing a photo.`);
    else if (target === "none") act({ action: "place", pieces: sel }, () => `Took ${sel.length} out of their lot.`);
    else if (target === "unlock") act({ action: "unlock", pieces: sel }, () => `Claude may place ${sel.length === 1 ? "that piece" : "those pieces"} again.`);
    else if (target.startsWith("to:")) {
      const o = others.find((x) => x.id === target.slice(3));
      if (o && window.confirm(`Carry ${sel.length} piece${sel.length === 1 ? "" : "s"} over to "${o.name}"? They get new numbers there and keep a "From ${build.name} #…" label.`))
        act({ action: "carry", toBuildId: o.id, pieces: sel }, (out) => `Carried ${(out.moved as unknown[] | undefined)?.length ?? 0} over to "${o.name}".`);
    } else if (target === "release") {
      if (window.confirm(`Take ${sel.length} piece${sel.length === 1 ? "" : "s"} out of the ${what}? They become ordinary Ready drafts.`))
        act({ action: "release", pieces: sel }, () => `Released ${sel.length} to Ready.`);
    } else if (/^\d+$/.test(target)) act({ action: "place", pieces: sel, lotNo: Number(target) }, () => `Moved ${sel.length} into lot ${target}.`);
  }

  function LotCard({ l }: { l: BuildLot }) {
    const mine = l.pieces.map((n) => byN.get(n)).filter((p): p is BuildPiece => !!p);
    const wantPhoto = mine.filter((p) => p.verdict === "need_photo");
    return (
      <div className="rounded border border-purple-700/50 bg-purple-50/40 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg font-bold">
            <span className="mr-2 rounded bg-purple-800 px-2 py-0.5 text-white">Lot {l.no}</span>
            {l.name}
          </h3>
          <span className="text-sm text-brand-ink/70">
            {mine.length} piece{mine.length === 1 ? "" : "s"} · alone {money(l.estTotal)} · suggested {money(l.suggestedPrice)}
          </span>
          <span className="ml-auto flex flex-wrap gap-1.5 print:hidden">
            <button
              className={BTN}
              disabled={busy}
              onClick={() => {
                const name = window.prompt("Lot name (the theme a buyer would search)", l.name);
                if (name && name.trim()) act({ action: "lot", no: l.no, name }, undefined, true);
              }}
            >
              Rename
            </button>
            <button
              className={BTN}
              disabled={busy}
              onClick={() => {
                const v = window.prompt("Suggested lot price (blank for none)", l.suggestedPrice != null ? String(l.suggestedPrice) : "");
                if (v !== null) act({ action: "lot", no: l.no, suggestedPrice: v.trim() === "" ? null : Number(v) }, undefined, true);
              }}
            >
              Price
            </button>
            <button className={BTN} disabled={busy} onClick={() => window.confirm(`Break up lot ${l.no}? Its pieces wait unplaced and the number is retired.`) && act({ action: "dissolve", no: l.no })}>
              Break up
            </button>
            <button
              className={BTN_DARK}
              disabled={busy || mine.length < 2}
              onClick={() => {
                const even = wantPhoto.length > 0;
                if (even && !window.confirm(`#${wantPhoto.map((p) => p.n).join(", #")} still want a photo. Build lot ${l.no} anyway?`)) return;
                act({ action: "build", no: l.no, evenIfNeedsPhoto: even }, (o) => `Lot ${l.no} built (${String(o.pieces)} pieces, ${String(o.photos)} photos) and queued for Claude to write.`);
              }}
            >
              Build this lot
            </button>
          </span>
        </div>
        {l.reason && <p className="mb-2 max-w-4xl text-sm text-brand-ink/75">{l.reason}</p>}
        {tiles(l.pieces)}
      </div>
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-marker text-4xl md:text-5xl">{build.name}</h1>
            <p className="mt-1 text-sm text-brand-ink/70">
              {preview && <span className="mr-2 rounded bg-sky-800 px-1.5 py-0.5 font-bold text-white">Preview</span>}
              {build.kind ?? (preview ? "Mixed batch" : "Item type not set")} · {build.pieces.filter((p) => p.state !== "removed").length} pieces · {live.length} still sorting ·{" "}
              {proposed.length} lot{proposed.length === 1 ? "" : "s"} proposed · {built.length} built
              {build.status !== "open" && <span className="ml-2 rounded bg-brand-ink/10 px-1.5 py-0.5">closed</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={BTN}
              disabled={busy}
              onClick={() => {
                const kind = window.prompt("What is this batch? (Claude uses it to pick the Expert Guide, e.g. “LP records”)", build.kind ?? "");
                if (kind !== null) act({ action: "session", kind }, undefined, true);
              }}
            >
              Item type
            </button>
            <button
              className={BTN}
              disabled={busy}
              onClick={() => {
                const note = window.prompt("A note for Claude about this batch (where it came from, what to watch for)", build.note ?? "");
                if (note !== null) act({ action: "session", note }, undefined, true);
              }}
            >
              Note for Claude
            </button>
            <button className={BTN} onClick={() => window.print()}>
              Print sorting guide
            </button>
            <button className={BTN} disabled={busy} onClick={() => act({ action: "session", status: build.status === "open" ? "closed" : "open" }, undefined, true)}>
              {build.status === "open" ? "Close session" : "Reopen"}
            </button>
            {preview && (
              <button
                className={BTN_DARK}
                disabled={busy || (!proposed.some((l) => l.pieces.length >= 2) && !pulls.length && !pools.length && !discards.length)}
                onClick={() =>
                  window.confirm(
                    `Apply this preview?\n\n` +
                      `• ${pulls.length} to Claude to write as individual listings\n` +
                      `• ${proposed.filter((l) => l.pieces.length >= 2).length} lot(s) built and sent to Claude to write\n` +
                      `• ${pools.length} into the lot pool (bin LOTPOOL)\n` +
                      `• ${discards.length} discarded (kept on record; restorable from the draft)\n\n` +
                      `${needPhoto.length + unplaced.length} piece(s) that need a better look or have no pile yet stay here.`
                  ) &&
                  act({ action: "apply" }, (o) => {
                    const left = (o.left as string[] | undefined) ?? [];
                    return `Applied: ${String(o.singles ?? 0)} single(s) and ${String(o.built ?? 0)} lot(s) sent to Claude, ${String(o.pooled ?? 0)} into the lot pool, ${String(o.discarded ?? 0)} discarded.${left.length ? ` Left: ${left.join(" ")}` : ""}`;
                  })
                }
              >
                Apply preview
              </button>
            )}
            {!preview && (
            <button
              className={BTN_DARK}
              disabled={busy || (!proposed.some((l) => l.pieces.length >= 2) && !pulls.length)}
              onClick={() =>
                window.confirm("Build every lot that's ready and send every pull to Claude to write? Lots with a piece still wanting a photo are left.") &&
                act({ action: "build_all" }, (o) => {
                  const b = (o.built as unknown[] | undefined)?.length ?? 0;
                  const left = (o.left as string[] | undefined) ?? [];
                  return `Built ${b} lot${b === 1 ? "" : "s"}, sent ${String(o.pulls ?? 0)} pull${o.pulls === 1 ? "" : "s"}.${left.length ? ` Left: ${left.join(" ")}` : ""}`;
                })
              }
            >
              Build all + send pulls
            </button>
            )}
          </div>
        </div>

        {preview && (
          <div className="mb-4 max-w-5xl">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ["single", "Individual listing", "bg-red-700"],
                  ["lot", "Lot from this batch", "bg-purple-800"],
                  ["pool", "Lot pool", "bg-teal-700"],
                  ["discard", "Discard", "bg-stone-600"],
                  ["look", "Needs a better look", "bg-amber-600"],
                  ["undecided", "No pile yet", "bg-brand-ink/40"],
                ] as const
              ).map(([key, label, tone]) => (
                <div key={key} className="rounded border border-brand-ink/15 bg-white p-2 text-sm">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold text-white ${tone}`}>{label}</span>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{report[key].pieces}</p>
                  <p className="text-xs text-brand-ink/60">alone ≈ {money(report[key].est)}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-brand-ink/60">
              Claude&rsquo;s rule of thumb: about ${PREVIEW_SINGLE_MIN} or more alone earns its own listing; under about ${PREVIEW_DISCARD_MAX} with no lot it would help is a
              discard; when in doubt it goes to the lot pool. Tick pieces to overrule any of it. Nothing moves until you press Apply preview.
            </p>
          </div>
        )}
        {build.note && <p className="mb-3 max-w-4xl text-sm text-brand-ink/70">Your note: {build.note}</p>}
        {build.planNote && (
          <p className="mb-4 max-w-4xl rounded border border-brand-ink/15 bg-white p-3 text-sm">
            <b>Claude&rsquo;s plan note:</b> {build.planNote}
          </p>
        )}
        {build.status === "open" &&
          leftovers.map((s) => (
            <div key={s.buildId} className="mb-4 max-w-4xl rounded border border-teal-700 bg-teal-50 p-3 text-sm text-teal-900">
              <div className="flex flex-wrap items-center gap-3">
                <b>
                  {s.pieces.length} leftover{s.pieces.length === 1 ? "" : "s"} in &ldquo;{s.name}&rdquo;
                </b>
                <span>not in any lot there. Pick a lot for each below, or bring them all in and place them later.</span>
                <button
                  className={`${BTN} ml-auto bg-white`}
                  disabled={busy}
                  onClick={() =>
                    act({ action: "carry", fromBuildId: s.buildId }, (out) => {
                      const m = (out.moved as Array<{ from: number; to: number }> | undefined) ?? [];
                      return `Brought in ${m.length} from "${s.name}": ${m.map((x) => `#${x.from} is now #${x.to}`).join(", ")}. They are under "Not in a lot yet".`;
                    })
                  }
                >
                  Bring all {s.pieces.length} in
                </button>
                <Link href={`/admin/listings/lot-builder/${s.buildId}`} className="underline">
                  open that session
                </Link>
              </div>
              <ul className="mt-2 space-y-1.5">
                {s.pieces.map((p) => (
                  <LeftoverRow
                    key={p.n}
                    p={p}
                    lots={proposed}
                    busy={busy}
                    onAdd={(lotNo) =>
                      act({ action: "carry", fromBuildId: s.buildId, pieces: [p.n], ...(lotNo != null ? { lotNo } : {}) }, (out) => {
                        const m = ((out.moved as Array<{ from: number; to: number }> | undefined) ?? [])[0];
                        return m
                          ? `"${s.name}" #${m.from} is now #${m.to} here, ${lotNo != null ? `in lot ${lotNo}` : `under "Not in a lot yet"`}. Fetch the record from the ${s.name} leftovers.`
                          : "Nothing moved.";
                      })
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        {waiting.length > 0 && (
          <p className="mb-4 max-w-4xl rounded border border-sky-700 bg-sky-50 p-3 text-sm text-sky-900">
            {waiting.length} piece{waiting.length === 1 ? " is" : "s are"} waiting for Claude (#{waiting.slice(0, 30).map((p) => p.n).join(", #")}
            {waiting.length > 30 ? "…" : ""}). In the Claude app, ask it to work the {what} session &ldquo;{build.name}&rdquo;.
          </p>
        )}
        {msg && <p className={`mb-4 rounded p-3 text-sm ${msg.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>{msg.text}</p>}

        {sel.length > 0 && (
          <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded border border-green-800 bg-green-50 p-3 text-sm shadow">
            <b>
              {sel.length} ticked (#{sel.slice(0, 12).join(", #")}
              {sel.length > 12 ? "…" : ""})
            </b>
            <select className="rounded border border-brand-ink/30 px-2 py-1" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Move to…</option>
              {proposed.map((l) => (
                <option key={l.no} value={String(l.no)}>
                  Lot {l.no} — {l.name}
                </option>
              ))}
              <option value="new">A new lot…</option>
              <option value="pull">{preview ? "Individual listing" : "PULL — sell alone"}</option>
              {preview && <option value="pool">Lot pool</option>}
              {preview && <option value="discard">Discard</option>}
              <option value="need_photo">{preview ? "Needs a better look" : "Needs a photo"}</option>
              <option value="none">Not in a lot</option>
              <option value="unlock">Let Claude place them again</option>
              {others.map((o) => (
                <option key={o.id} value={`to:${o.id}`}>
                  Carry over to session: {o.name}
                </option>
              ))}
              <option value="release">Out of the {what} (ordinary drafts)</option>
            </select>
            {target === "new" && <input className="rounded border border-brand-ink/30 px-2 py-1" placeholder="Lot name" value={newLot} onChange={(e) => setNewLot(e.target.value)} />}
            <button className={BTN_DARK} disabled={busy || !target} onClick={move}>
              Go
            </button>
            <button className={BTN} onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-brand-ink/15 pb-3">
          <button className={view === "lots" ? BTN_DARK : BTN} onClick={() => setView("lots")}>
            Lots
          </button>
          <button className={view === "sort" ? BTN_DARK : BTN} onClick={() => setView("sort")}>
            Sort the stack (#1 to #{guide.length ? guide[guide.length - 1].n : 0})
          </button>
          <span className="text-sm text-brand-ink/60">
            {view === "lots" ? "Which pieces are in which lot. Tick pieces to move them." : "Your stack in the order you photographed it: where each piece goes."}
          </span>
        </div>

        {view === "sort" && (
          <div className="mb-6">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <span>Start from:</span>
              <button className={!desc ? BTN_DARK : BTN} onClick={() => setDesc(false)}>
                #1 first
              </button>
              <button className={desc ? BTN_DARK : BTN} onClick={() => setDesc(true)}>
                #{guide.length ? guide[guide.length - 1].n : 0} first (work backwards)
              </button>
              <span className="ml-2 text-brand-ink/70">
                {guide.filter((r) => placed.has(r.n)).length} of {guide.length} placed. Tap a row when the piece is on its pile.
              </span>
              {placed.size > 0 && (
                <button className={BTN} onClick={() => savePlaced(new Set())}>
                  Clear ticks
                </button>
              )}
            </div>
            <ol className="max-w-3xl space-y-1.5">
              {ordered.map((r) => {
                const p = byN.get(r.n);
                const isPlaced = placed.has(r.n);
                return (
                  <li key={r.n}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(placed);
                        if (isPlaced) next.delete(r.n);
                        else next.add(r.n);
                        savePlaced(next);
                      }}
                      className={`flex w-full items-center gap-3 rounded border-2 bg-white p-2 text-left ${
                        isPlaced ? "border-brand-ink/10 opacity-40" : r.n === nextUp ? "border-green-800 ring-2 ring-green-800/30" : "border-brand-ink/15"
                      }`}
                    >
                      <span className="w-16 shrink-0 text-center text-3xl font-bold tabular-nums">{r.n}</span>
                      {p?.front ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.front} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded bg-brand-ink/5 object-contain" />
                      ) : (
                        <span className="h-16 w-16 shrink-0 rounded bg-brand-ink/5" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={`inline-block rounded px-2.5 py-1 text-lg font-bold ${whereTone(r)}`}>{whereShort(r, p?.lotNo ?? null)}</span>
                        {(r.kind === "lot" || r.kind === "done") && p?.lotNo != null && (
                          <span className="ml-2 text-sm text-brand-ink/70">{build.lots.find((l) => l.no === p.lotNo)?.name}</span>
                        )}
                        <span className="block truncate text-sm text-brand-ink/60">
                          {p?.origin && <b className="text-teal-800">From {p.origin.name} #{p.origin.n} · </b>}
                          {r.what ?? "not identified yet"}
                        </span>
                      </span>
                      <span className="w-8 shrink-0 text-center text-2xl">{isPlaced ? "✓" : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {view === "lots" && (
          <>
        {pulls.length > 0 && (
          <div className="mb-6 rounded border-2 border-red-700 bg-red-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-red-900">{preview ? "Individual listings" : "Pull these — sell individually"} ({pulls.length})</h2>
              <button className={`${BTN} ml-auto`} disabled={busy} onClick={() => act({ action: "pulls" }, (o) => `Sent ${String(o.sent)} to Claude to write as single listings.`)}>
                Send all pulls to Claude
              </button>
            </div>
            <p className="mb-2 text-sm text-red-900/80">
              {preview
                ? "Worth a listing of their own. They go to Claude to write with the photos they already have. Disagree? Tick it and move it."
                : "Take these out of the pile. Add a label or back photo first if a single listing needs it. Disagree? Tick it and move it to a lot."}
            </p>
            {tiles(pulls.map((p) => p.n))}
          </div>
        )}

        {needPhoto.length > 0 && (
          <div className="mb-6 rounded border-2 border-amber-600 bg-amber-50/60 p-3">
            <h2 className="mb-1 text-xl font-bold text-amber-900">{preview ? "Needs a better look" : "One photo wasn\u2019t enough"} ({needPhoto.length})</h2>
            <p className="mb-2 text-sm text-amber-900/80">
              {preview
                ? "The scans don\u2019t settle these. Use \u201c+ photo\u201d (phone or PC) and Claude looks again, or tick one and choose its pile yourself."
                : "Use \u201c+ photo\u201d on each (phone or PC). Claude looks again and decides: pull or lot."}
            </p>
            {tiles(needPhoto.map((p) => p.n))}
          </div>
        )}

        <div className="mb-6 space-y-4">
          {proposed.map((l) => (
            <LotCard key={l.no} l={l} />
          ))}
          {proposed.length === 0 && live.length > 0 && <p className="text-sm text-brand-ink/60">No lots proposed yet. Claude proposes them once it has identified the pieces, or tick pieces and start one yourself.</p>}
        </div>

        {pools.length > 0 && (
          <div className="mb-6 rounded border-2 border-teal-700 bg-teal-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-teal-900">Lot pool ({pools.length})</h2>
              <button className={`${BTN} ml-auto`} disabled={busy} onClick={() => act({ action: "pool" }, (o) => `Sent ${String(o.pooled)} to the lot pool.${((o.left as string[] | undefined) ?? []).length ? ` Left: ${(o.left as string[]).join(" ")}` : ""}`)}>
                Send these to the lot pool now
              </button>
            </div>
            <p className="mb-2 text-sm text-teal-900/80">Some value in a lot, but nothing in this batch goes with them. They wait in the lot pool (bin LOTPOOL) with these photos for partners from other batches.</p>
            {tiles(pools.map((p) => p.n))}
          </div>
        )}

        {discards.length > 0 && (
          <div className="mb-6 rounded border-2 border-stone-500 bg-stone-100/70 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-stone-800">Discard ({discards.length})</h2>
              <button
                className={`${BTN} ml-auto`}
                disabled={busy}
                onClick={() =>
                  window.confirm(`Discard ${discards.length} piece${discards.length === 1 ? "" : "s"}? Each is kept on record with what it was and why, and can be restored from its draft page.`) &&
                  act({ action: "discard" }, (o) => `Discarded ${String(o.discarded)}.`)
                }
              >
                Discard these now
              </button>
            </div>
            <p className="mb-2 text-sm text-stone-700">Not worth more of your time, even in a lot. Check these before applying: a wrong discard is the costly mistake. Tick any you&rsquo;d keep and move it to the lot pool.</p>
            {tiles(discards.map((p) => p.n))}
          </div>
        )}

        {unplaced.length > 0 && (
          <div className="mb-6 rounded border border-brand-ink/15 p-3">
            <h2 className="mb-2 text-xl font-bold">{preview ? "No pile yet" : "Not in a lot yet"} ({unplaced.length})</h2>
            {tiles(unplaced.map((p) => p.n))}
          </div>
        )}

        {(built.length > 0 || sent.length > 0 || pooledDone.length > 0 || discardedDone.length > 0) && (
          <div className="mb-6 rounded border border-green-800/40 bg-green-50/40 p-3 text-sm">
            <h2 className="mb-2 text-xl font-bold">Built and sent on</h2>
            <ul className="space-y-1">
              {built.map((l) => (
                <li key={l.no}>
                  <span className="mr-2 rounded bg-green-800 px-1.5 py-0.5 font-bold text-white">Lot {l.no}</span>
                  {l.name} — {l.pieces.length} pieces (#{l.pieces.join(", #")}) ·{" "}
                  {l.lotDraftId && (
                    <Link href={`/admin/listings/${l.lotDraftId}`} className="underline">
                      open the lot draft
                    </Link>
                  )}{" "}
                  <span className="text-brand-ink/60">({(l.lotDraftStatus ?? "").replace("_", " ")}; split it there to bring the pieces back)</span>
                </li>
              ))}
              {sent.map((p) => (
                <li key={p.n}>
                  <span className="mr-2 rounded bg-red-700 px-1.5 py-0.5 font-bold text-white">#{p.n}</span>
                  {preview ? "individual listing" : "pulled"}:{" "}
                  <Link href={`/admin/listings/${p.draftId}`} className="underline">
                    {p.identification ?? "single listing"}
                  </Link>
                </li>
              ))}
              {pooledDone.length > 0 && (
                <li>
                  <span className="mr-2 rounded bg-teal-700 px-1.5 py-0.5 font-bold text-white">Lot pool</span>
                  {pooledDone.length} piece{pooledDone.length === 1 ? "" : "s"} (#{pooledDone.map((p) => p.n).join(", #")}) ·{" "}
                  <Link href="/admin/listings/pool" className="underline">
                    open the lot pool
                  </Link>
                </li>
              )}
              {discardedDone.map((p) => (
                <li key={p.n}>
                  <span className="mr-2 rounded bg-stone-600 px-1.5 py-0.5 font-bold text-white">#{p.n}</span>
                  discarded:{" "}
                  <Link href={`/admin/listings/${p.draftId}`} className="underline">
                    {p.identification ?? "open the draft"}
                  </Link>
                  {p.reason && <span className="text-brand-ink/60"> — {p.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
          </>
        )}
      </div>

      <div className={`rounded border border-brand-ink/15 bg-white p-3 print:block print:border-0 print:p-0 ${view === "sort" ? "hidden" : ""}`}>
        <h2 className="mb-1 text-xl font-bold">
          Sorting guide <span className="hidden print:inline">— {build.name}{desc ? " (last piece first)" : ""}</span>
        </h2>
        <p className="mb-2 text-sm text-brand-ink/60 print:hidden">
          Every piece in the order you photographed it. For a bigger list you can tick off, in either direction, use{" "}
          <button className="underline" onClick={() => setView("sort")}>
            Sort the stack
          </button>
          . Printing uses the direction chosen there.
        </p>
        <ol className="columns-1 gap-6 text-sm sm:columns-2 lg:columns-3 print:columns-3 print:text-xs">
          {ordered.map((r) => (
            <li key={r.n} className="mb-0.5 break-inside-avoid">
              <b className="inline-block w-10">#{r.n}</b>
              <span className={r.kind === "pull" ? "font-bold text-red-800" : r.kind === "photo" ? "font-bold text-amber-800" : r.kind === "pool" ? "font-bold text-teal-800" : r.kind === "discard" ? "font-bold text-stone-600" : r.kind === "none" ? "text-brand-ink/50" : ""}>{r.where}</span>
              {byN.get(r.n)?.origin && <span className="text-teal-800"> · from {byN.get(r.n)!.origin!.name} #{byN.get(r.n)!.origin!.n}</span>}
              {r.what && <span className="text-brand-ink/60"> · {r.what.slice(0, 60)}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
