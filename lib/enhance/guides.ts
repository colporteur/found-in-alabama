// Expert guide library for the remix ops (Phase 3).
//
// Guides are markdown files under content/expert-guides/, described by
// manifest.json (decision #5: manifest scaffolding now, shared guide
// library with the Nifty extension later). Files ship inside the Vercel
// bundle like content/posts does, so reads are plain fs at runtime.
//
// A guide is the LARGE cacheable prompt prefix (decision #7): passed to
// callLlm as `cacheableSystem`, so Anthropic bills it at 10% on every
// call after the first within the cache window.

import fs from "fs";
import path from "path";

const GUIDES_DIR = path.join(process.cwd(), "content", "expert-guides");

export type GuideMeta = {
  id: string;
  name: string;
  file: string;
  keywords: string[];
};

type Manifest = { version: number; guides: GuideMeta[] };

export function listGuides(): GuideMeta[] {
  try {
    const raw = fs.readFileSync(path.join(GUIDES_DIR, "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw) as Manifest;
    return Array.isArray(manifest.guides) ? manifest.guides : [];
  } catch (err) {
    console.error("[guides] failed to read manifest:", err);
    return [];
  }
}

export type Guide = GuideMeta & { content: string };

export function loadGuide(id: string): Guide | null {
  const meta = listGuides().find((g) => g.id === id);
  if (!meta) return null;
  // Guard against path traversal — file must stay inside GUIDES_DIR.
  const file = path.join(GUIDES_DIR, path.basename(meta.file));
  try {
    const content = fs.readFileSync(file, "utf-8");
    return { ...meta, content };
  } catch (err) {
    console.error(`[guides] failed to read guide "${id}":`, err);
    return null;
  }
}
