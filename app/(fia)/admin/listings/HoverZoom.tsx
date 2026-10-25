"use client";

// Hover a listing photo to see a much larger copy of it, floating beside the
// thumbnail (whichever side has room) and kept inside the window. Only on
// devices with a real mouse — on a phone a tap still just opens the draft.
// Rendered into <body> so the table's scroll box can't clip it.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 12;
const DELAY_MS = 120;

export function HoverZoom({ src, children, className }: { src: string | null; children: React.ReactNode; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; size: number } | null>(null);
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    try {
      setCanHover(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    } catch {
      setCanHover(false);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Close if the page scrolls out from under the preview.
  useEffect(() => {
    if (!box) return;
    const close = () => setBox(null);
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [box]);

  const show = () => {
    if (!src || !canHover || !wrap.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const size = Math.min(640, vh - GAP * 2, Math.max(vw - r.right, r.left) - GAP * 2);
      if (size < 160) return;
      const right = vw - r.right >= size + GAP * 2;
      const left = right ? r.right + GAP : r.left - GAP - size;
      const top = Math.max(GAP, Math.min(r.top + r.height / 2 - size / 2, vh - size - GAP));
      setBox({ left, top, size });
    }, DELAY_MS);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setBox(null);
  };

  return (
    <div ref={wrap} onMouseEnter={show} onMouseLeave={hide} className={className ?? "block"}>
      {children}
      {box &&
        src &&
        createPortal(
          <div
            aria-hidden
            className="fixed z-[1000] pointer-events-none bg-white rounded-lg shadow-2xl border border-brand-ink/20 p-1.5 flex items-center justify-center"
            style={{ left: box.left, top: box.top, width: box.size, height: box.size }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} className="object-contain rounded" />
          </div>,
          document.body
        )}
    </div>
  );
}
