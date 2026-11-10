"use client";

// Homepage promo video (FIA + TES). Inline it plays muted on a loop;
// clicking it opens a larger player in an overlay with controls.
// Close with the button, a click on the backdrop, or Escape.

import { useEffect, useState } from "react";

type Props = {
  src: string;
  poster: string;
  label: string;
  /** Classes for the inline video frame (ring/background per site). */
  frameClassName?: string;
};

export default function PromoVideo({ src, poster, label, frameClassName = "" }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full cursor-zoom-in text-left"
        aria-label={`${label} (open larger video)`}
      >
        <video
          className={`w-full aspect-video rounded-lg shadow-md ${frameClassName}`}
          src={src}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/65 px-2.5 py-1 text-xs font-medium text-white opacity-80 transition-opacity group-hover:opacity-100">
          ⤢ Watch larger
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-6"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setOpen(false)}
                className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
              >
                Close ✕
              </button>
            </div>
            <video
              className="w-full max-h-[80vh] aspect-video rounded-lg bg-black"
              src={src}
              poster={poster}
              controls
              autoPlay
              muted
              loop
              playsInline
            />
          </div>
        </div>
      )}
    </>
  );
}
