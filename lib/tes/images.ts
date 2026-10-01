// eBay's Trading API returns "$_1.JPG" picture URLs, which are only 400px
// wide. Rewrite to "$_57" (1600px) for anything shown large or handed to
// Google / social previews. Non-eBay URLs pass through unchanged.
export function largeEbayImage(url: string): string {
  return url.replace(/\$_\d+\.(jpe?g|png|webp)/i, "$_57.$1");
}
