"use client";

// TES product-page photo gallery. Shows one large photo with a clickable
// thumbnail strip directly under it — clicking a thumbnail swaps the main
// photo (no new tab). The main photo is height-capped so the thumbnails
// stay above the fold on a laptop screen. The large photo links to the
// full-size image.
//
// eBay's Trading API hands back "$_1.JPG" picture URLs, which are only
// 400px wide. largeEbayImage() rewrites them to "$_57.JPG" (1600px) for
// the main photo; thumbnails keep the small size.

import { useState } from "react";

export function largeEbayImage(url: string): string {
  return url.replace(/\$_\d+\.(jpe?g|png|webp)/i, "$_57.$1");
}

// Class sets per storefront (Tailwind needs the literal strings).
const THEMES = {
  tes: {
    frame: "ring-tes-ink/10",
    empty: "font-typewriter text-2xl text-tes-ink/30",
    caption: "text-xs text-tes-ink/50 mt-2",
    thumbOn: "ring-2 ring-tes-kraft",
    thumbOff: "ring-tes-ink/10 hover:ring-tes-kraft",
  },
  fia: {
    frame: "ring-brand-ink/10",
    empty: "font-marker text-2xl text-brand-ink/30",
    caption: "text-xs text-brand-ink/50 mt-2",
    thumbOn: "ring-2 ring-brand-yellow",
    thumbOff: "ring-brand-ink/10 hover:ring-brand-yellow",
  },
} as const;

export default function ItemGallery({
  images,
  title,
  theme = "tes",
}: {
  images: string[];
  title: string;
  /** "fia" for foundinalabama.com product pages (Phase FIA-SHOP-1). */
  theme?: keyof typeof THEMES;
}) {
  const [active, setActive] = useState(0);
  const t = THEMES[theme];

  if (images.length === 0) {
    return (
      <div className={`aspect-square bg-white rounded-xl ring-1 ${t.frame} flex items-center justify-center`}>
        <span className={t.empty}>
          No photo
        </span>
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];
  const big = largeEbayImage(current);

  return (
    <div>
      <a
        href={big}
        target="_blank"
        rel="noopener noreferrer"
        title="Open full size"
        className={`block bg-white rounded-xl ring-1 ${t.frame} overflow-hidden`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={big}
          src={big}
          alt={
            images.length > 1
              ? `${title} — photo ${active + 1} of ${images.length}`
              : title
          }
          className="w-full max-h-[65vh] object-contain"
        />
      </a>

      {images.length > 1 && (
        <>
          <p className={t.caption}>
            Photo {active + 1} of {images.length}
          </p>
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 mt-1">
            {images.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-current={i === active}
                className={`rounded-lg overflow-hidden bg-white ring-1 transition ${
                  i === active
                    ? t.thumbOn
                    : t.thumbOff
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
