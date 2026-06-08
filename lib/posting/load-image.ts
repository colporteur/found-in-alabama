// Resolve a hero image URL — local /photos/... path or external http(s) URL —
// into a buffer + media type. Returns null if it can't be loaded.

import fs from "fs/promises";
import path from "path";
import type { LoadedImage } from "@/lib/posting/types";

function mediaTypeFromExt(ext: string): LoadedImage["mediaType"] {
  const e = ext.toLowerCase().replace(/^\./, "");
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  return "image/jpeg";
}

export async function loadImage(
  src: string | null | undefined
): Promise<LoadedImage | null> {
  if (!src) return null;
  try {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      let mt: LoadedImage["mediaType"] = "image/jpeg";
      if (ct.includes("png")) mt = "image/png";
      else if (ct.includes("webp")) mt = "image/webp";
      else if (ct.includes("gif")) mt = "image/gif";
      else {
        const ext = src.split("?")[0].split(".").pop() ?? "";
        mt = mediaTypeFromExt(ext);
      }
      return { data: buf, mediaType: mt };
    }
    // Local path under public/
    const rel = src.startsWith("/") ? src.slice(1) : src;
    const absolute = path.join(process.cwd(), "public", rel);
    const buf = await fs.readFile(absolute);
    const ext = absolute.split(".").pop() ?? "";
    return { data: buf, mediaType: mediaTypeFromExt(ext) };
  } catch {
    return null;
  }
}
