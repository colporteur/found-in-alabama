"use client";

// Archive / unarchive, mark unread, reply (mailto), download .eml.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MessageActions({
  id,
  archived,
  replyHref,
}: {
  id: string;
  archived: boolean;
  replyHref: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(body: { read?: boolean; archived?: boolean }, then: "back" | "refresh") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/email/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (then === "back") {
        router.push("/admin/mail");
        router.refresh();
      } else router.refresh();
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "px-3 py-1.5 rounded border border-brand-ink/20 text-sm hover:border-brand-ink/50 disabled:opacity-40";

  return (
    <div className="flex flex-wrap gap-2">
      {replyHref && (
        <a href={replyHref} className={btn}>
          Reply
        </a>
      )}
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={() => patch({ archived: !archived }, archived ? "refresh" : "back")}
      >
        {archived ? "Move to inbox" : "Archive"}
      </button>
      <button
        type="button"
        className={btn}
        disabled={busy}
        onClick={() => patch({ read: false }, "back")}
      >
        Mark unread
      </button>
      <a href={`/api/admin/email/messages/${id}/raw`} className={btn}>
        Download .eml
      </a>
    </div>
  );
}
