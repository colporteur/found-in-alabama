"use client";

// The Lot Builder board for one sort session. Top to bottom: what needs Todd
// (pieces Claude says to PULL and sell alone, pieces that NEED A PHOTO), the
// lots (numbers are the physical piles), pieces not placed yet, what's
// already built or sent on, and the sorting guide (also the print view).
// Tick pieces, then use the bar to move them; anything Todd places is locked
// so Claude's later passes leave it alone. Photos can be added to any piece.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Build, BuildLot, BuildPiece } from "@/lib/listings/lot-build";
import { sortingGuide } from "@/lib/listings/lot-build-plan";
import { downsize, sha256 } from "../../photoPrep";

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const BTN = "text-xs px-2 py-1 rounded border border-brand-ink/20 hover:border-brand-ink/50 disabled:opacity-40";
const BTN_DARK = "text-sm px-3 py-1.5 rounded font-medium bg-brand-ink text-white hover:bg-brand-ink/80 disabled:opacity-40";

type Ctx = {
  busy: boolean;
  picked: Set<number>;
  toggle: (n: number) => void;
  addPhotos: (p: BuildPiece, files: FileList | null) => void;
};

function Tile({ p, ctx }: { p: BuildPiece; ctx: Ctx }) {
  const live = p.state === "sorting";
  const on = ctx.picked.has(p.n);
  const tone = p.verdict === "pull" || p.state === "pulled" ? "border-red-700" : p.verdict === "need_photo" && live ? "border-amber-600" : on ? "border-green-800" : "border-brand-ink/15";
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
      {p.verdict === "need_photo" && live && <p className="mt-1 rounded bg-amber-50 p-1 text-amber-900">Photo wanted: {p.photoRequest ?? "another photo"}</p>}
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

export function BuildBoard({ build }: { build: Build }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState("");
  const [newLot, setNewLot] = useState("");

  const live = build.pieces.filter((p) => p.state === "sorting");
  const pulls = live.filter((p) => p.verdict === "pull");
  const needPhoto = live.filter((p) => p.verdict === "need_photo");
  const proposed = build.lots.filter((l) => l.status === "proposed");
  const built = build.lots.filter((l) => l.status === "built");
  const unplaced = live.filter((p) => p.lotNo == null && p.verdict !== "pull" && p.verdict !== "need_photo");
  const waiting = live.filter((p) => p.needsLook);
  const sent = build.pieces.filter((p) => p.state === "pulled");
  const byN = useMemo(() => new Map(build.pieces.map((p) => [p.n, p])), [build.pieces]);
  const guide = useMemo(() => sortingGuide(build.pieces, new Map(build.lots.map((l) => [l.no, l.name]))), [build.pieces, build.lots]);

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

  const ctx: Ctx = { busy, picked, toggle, addPhotos };
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
    } else if (target === "pull") act({ action: "place", pieces: sel, verdict: "pull" }, () => `Marked ${sel.length} to pull.`);
    else if (target === "need_photo") act({ action: "place", pieces: sel, verdict: "need_photo" }, () => `Marked ${sel.length} as needing a photo.`);
    else if (target === "none") act({ action: "place", pieces: sel }, () => `Took ${sel.length} out of their lot.`);
    else if (target === "unlock") act({ action: "unlock", pieces: sel }, () => `Claude may place ${sel.length === 1 ? "that piece" : "those pieces"} again.`);
    else if (target === "release") {
      if (window.confirm(`Take ${sel.length} piece${sel.length === 1 ? "" : "s"} out of the Lot Builder? They become ordinary Ready drafts.`))
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
              {build.kind ?? "Item type not set"} · {build.pieces.filter((p) => p.state !== "removed").length} pieces · {live.length} still sorting ·{" "}
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
          </div>
        </div>

        {build.note && <p className="mb-3 max-w-4xl text-sm text-brand-ink/70">Your note: {build.note}</p>}
        {build.planNote && (
          <p className="mb-4 max-w-4xl rounded border border-brand-ink/15 bg-white p-3 text-sm">
            <b>Claude&rsquo;s plan note:</b> {build.planNote}
          </p>
        )}
        {waiting.length > 0 && (
          <p className="mb-4 max-w-4xl rounded border border-sky-700 bg-sky-50 p-3 text-sm text-sky-900">
            {waiting.length} piece{waiting.length === 1 ? " is" : "s are"} waiting for Claude (#{waiting.slice(0, 30).map((p) => p.n).join(", #")}
            {waiting.length > 30 ? "…" : ""}). In the Claude app, ask it to work the Lot Builder session &ldquo;{build.name}&rdquo;.
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
              <option value="pull">PULL — sell alone</option>
              <option value="need_photo">Needs a photo</option>
              <option value="none">Not in a lot</option>
              <option value="unlock">Let Claude place them again</option>
              <option value="release">Out of the Lot Builder (ordinary drafts)</option>
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

        {pulls.length > 0 && (
          <div className="mb-6 rounded border-2 border-red-700 bg-red-50/60 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-red-900">Pull these — sell individually ({pulls.length})</h2>
              <button className={`${BTN} ml-auto`} disabled={busy} onClick={() => act({ action: "pulls" }, (o) => `Sent ${String(o.sent)} to Claude to write as single listings.`)}>
                Send all pulls to Claude
              </button>
            </div>
            <p className="mb-2 text-sm text-red-900/80">Take these out of the pile. Add a label or back photo first if a single listing needs it. Disagree? Tick it and move it to a lot.</p>
            {tiles(pulls.map((p) => p.n))}
          </div>
        )}

        {needPhoto.length > 0 && (
          <div className="mb-6 rounded border-2 border-amber-600 bg-amber-50/60 p-3">
            <h2 className="mb-1 text-xl font-bold text-amber-900">One photo wasn&rsquo;t enough ({needPhoto.length})</h2>
            <p className="mb-2 text-sm text-amber-900/80">Use &ldquo;+ photo&rdquo; on each (phone or PC). Claude looks again and decides: pull or lot.</p>
            {tiles(needPhoto.map((p) => p.n))}
          </div>
        )}

        <div className="mb-6 space-y-4">
          {proposed.map((l) => (
            <LotCard key={l.no} l={l} />
          ))}
          {proposed.length === 0 && live.length > 0 && <p className="text-sm text-brand-ink/60">No lots proposed yet. Claude proposes them once it has identified the pieces, or tick pieces and start one yourself.</p>}
        </div>

        {unplaced.length > 0 && (
          <div className="mb-6 rounded border border-brand-ink/15 p-3">
            <h2 className="mb-2 text-xl font-bold">Not in a lot yet ({unplaced.length})</h2>
            {tiles(unplaced.map((p) => p.n))}
          </div>
        )}

        {(built.length > 0 || sent.length > 0) && (
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
                  pulled:{" "}
                  <Link href={`/admin/listings/${p.draftId}`} className="underline">
                    {p.identification ?? "single listing"}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded border border-brand-ink/15 bg-white p-3 print:border-0 print:p-0">
        <h2 className="mb-1 text-xl font-bold">
          Sorting guide <span className="hidden print:inline">— {build.name}</span>
        </h2>
        <p className="mb-2 text-sm text-brand-ink/60 print:hidden">Piece numbers are the order you sent them. Work down the pile and drop each on its numbered lot.</p>
        <ol className="columns-1 gap-6 text-sm sm:columns-2 lg:columns-3 print:columns-3 print:text-xs">
          {guide.map((r) => (
            <li key={r.n} className="mb-0.5 break-inside-avoid">
              <b className="inline-block w-10">#{r.n}</b>
              <span className={r.kind === "pull" ? "font-bold text-red-800" : r.kind === "photo" ? "font-bold text-amber-800" : r.kind === "none" ? "text-brand-ink/50" : ""}>{r.where}</span>
              {r.what && <span className="text-brand-ink/60"> · {r.what.slice(0, 60)}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
