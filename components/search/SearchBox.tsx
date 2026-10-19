"use client";

// Header search box with suggestions as you type (SEARCH-1). Used by both
// storefronts; `site` picks which items are suggested and the look. Works
// without JavaScript too (it's a plain GET form to /search).

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = {
  categories: Array<{ name: string; slug: string; count: number }>;
  items: Array<{ itemId: string; title: string; price: string | null; imageUrl: string | null }>;
};
type Option = { key: string; href: string; label: string; sub?: string; img?: string | null; kind: "search" | "cat" | "item" };

const THEME = {
  fia: {
    input:
      "w-full border border-brand-ink/20 rounded-full pl-9 pr-4 py-1.5 text-sm bg-white focus:outline-none focus:border-brand-yellow",
    panel: "border-brand-ink/15",
    active: "bg-brand-yellow/30",
    icon: "text-brand-ink/40",
  },
  tes: {
    input:
      "w-full border border-tes-ink/15 rounded-full pl-9 pr-4 py-1.5 text-sm bg-white focus:outline-none focus:border-tes-kraft",
    panel: "border-tes-ink/15",
    active: "bg-tes-kraft/20",
    icon: "text-tes-ink/40",
  },
};

const money = (p: string | null) => (p && Number.isFinite(Number(p)) ? `$${Number(p).toFixed(2)}` : "");

export default function SearchBox({
  site,
  placeholder = "Search…",
  className = "",
  initial = "",
}: {
  site: "fia" | "tes";
  placeholder?: string;
  className?: string;
  initial?: string;
}) {
  const router = useRouter();
  const theme = THEME[site];
  const listId = useId();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);

  // Fetch suggestions a moment after typing stops.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setData(null);
      return;
    }
    const n = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?site=${site}&q=${encodeURIComponent(text)}`);
        const out = (await res.json()) as Suggestion;
        if (n === reqRef.current) {
          setData(out);
          setActive(-1);
        }
      } catch {
        /* suggestions are optional */
      }
    }, 160);
    return () => clearTimeout(t);
  }, [q, site]);

  // Close when clicking elsewhere.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const text = q.trim();
  const options: Option[] = [];
  if (text.length >= 2) {
    options.push({ key: "search", kind: "search", href: `/search?q=${encodeURIComponent(text)}`, label: `Search for “${text}”` });
    for (const c of data?.categories ?? [])
      options.push({ key: `c${c.slug}`, kind: "cat", href: `/shop/${c.slug}`, label: c.name, sub: `${c.count.toLocaleString()} in stock` });
    for (const it of data?.items ?? [])
      options.push({ key: `i${it.itemId}`, kind: "item", href: `/item/${it.itemId}`, label: it.title, sub: money(it.price), img: it.imageUrl });
  }
  const show = open && options.length > 0;

  function go(o: Option | undefined) {
    if (!o) return;
    setOpen(false);
    router.push(o.href);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <form
        method="GET"
        action="/search"
        role="search"
        onSubmit={(e) => {
          if (active >= 0 && options[active]) {
            e.preventDefault();
            go(options[active]);
          } else {
            setOpen(false);
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${theme.icon}`}>
          <path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className={theme.input}
        />
      </form>
      {show && (
        <ul
          id={listId}
          role="listbox"
          className={`absolute z-50 mt-1 w-full min-w-[18rem] max-w-[calc(100vw-2rem)] right-0 sm:left-0 rounded-lg border bg-white shadow-lg overflow-hidden text-sm ${theme.panel}`}
        >
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${i === active ? theme.active : ""} ${
                o.kind === "cat" && options[i - 1]?.kind === "search" ? "border-t border-black/5" : ""
              } ${o.kind === "item" && options[i - 1]?.kind !== "item" ? "border-t border-black/5" : ""}`}
            >
              {o.kind === "item" ? (
                o.img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.img} alt="" className="h-9 w-9 rounded object-cover flex-none" loading="lazy" />
                ) : (
                  <span className="h-9 w-9 rounded bg-black/5 flex-none" />
                )
              ) : (
                <span className="h-9 w-9 flex-none flex items-center justify-center text-xs opacity-60">
                  {o.kind === "search" ? "↵" : "▤"}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${o.kind === "search" ? "font-semibold" : ""}`}>{o.label}</span>
                {o.sub && <span className="block text-xs opacity-60">{o.kind === "cat" ? `Shelf · ${o.sub}` : o.sub}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
