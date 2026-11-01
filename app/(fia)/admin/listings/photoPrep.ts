// Browser-side photo prep shared by the manual lister and "Add photos":
// shrink to 3200 px and JPEG under the app's 4.5 MB request limit, and hash
// it (the upload route checks the bytes match what was registered).

const MAX_EDGE = 3200;

export async function downsize(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  // Stay under the app's 4.5 MB request limit: step the quality down if needed.
  for (const q of [0.9, 0.82, 0.72, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
    if (!blob) throw new Error(`Couldn't read ${file.name}`);
    if (blob.size < 4_000_000) return blob;
  }
  throw new Error(`${file.name} is too large even after resizing`);
}

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
