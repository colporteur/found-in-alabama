// eBay photo hosting for listings FIA publishes (lib/ebay/publish.ts).
//
// eBay retired the Trading API's UploadSiteHostedPictures (decommissioned
// 2026-09-30; it started answering HTTP 404 on 2026-10-27). Two roads now:
//
//   1. Media API createImageFromUrl — eBay's replacement. Needs the OAuth
//      scope sell.inventory, which only arrives after a re-connect at
//      /admin/ebay/sales/connect (REQUIRED_SCOPES lists it).
//   2. Until then: hand eBay our own https photo links in the listing
//      itself. eBay copies them into its picture hosting when the listing
//      is created — the same links its VerifyAddFixedPriceItem check
//      already accepts.

import { getValidAccessToken, hasGrantedScope, INVENTORY_SCOPE } from "./oauth";
import { imageIdFromLocation } from "./publish-core";

function mediaHost(): string {
  return (process.env.EBAY_ENV ?? "production") === "sandbox"
    ? "https://apim.sandbox.ebay.com"
    : "https://apim.ebay.com";
}

type ImageResponse = { imageUrl?: string; expirationDate?: string };

async function mediaFetch(token: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${mediaHost()}/commerce/media/v1_beta${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

/** Copy one https photo into eBay's picture hosting; returns eBay's URL. */
async function createImageFromUrl(url: string): Promise<string> {
  const token = await getValidAccessToken();
  if (!token) throw new Error("eBay connection expired — reconnect at /admin/ebay/sales/connect");

  const res = await mediaFetch(token, "/image/create_image_from_url", {
    method: "POST",
    body: JSON.stringify({ imageUrl: url }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`eBay Media createImageFromUrl HTTP ${res.status}: ${text.slice(0, 300)}`);

  const body = (text ? JSON.parse(text) : {}) as ImageResponse;
  if (body.imageUrl) return body.imageUrl;

  // Some responses carry only the Location of the new image.
  const id = imageIdFromLocation(res.headers.get("location"));
  if (!id) throw new Error("eBay took the photo but returned no image link");
  const got = await mediaFetch(token, `/image/${encodeURIComponent(id)}`, { method: "GET" });
  const gotText = await got.text();
  if (!got.ok) throw new Error(`eBay Media getImage HTTP ${got.status}: ${gotText.slice(0, 300)}`);
  const img = JSON.parse(gotText) as ImageResponse;
  if (!img.imageUrl) throw new Error("eBay returned no image link for the uploaded photo");
  return img.imageUrl;
}

/** The photo links to put in a new listing (at most 24, in order).
 *  `via` says which road was used, for the publish record. */
export async function hostPhotosForListing(
  urls: string[]
): Promise<{ urls: string[]; via: "media-api" | "direct-links" }> {
  const list = urls.slice(0, 24);
  const canUseMedia = await hasGrantedScope(INVENTORY_SCOPE).catch(() => false);
  if (!canUseMedia) return { urls: list, via: "direct-links" };

  const hosted: string[] = [];
  for (const url of list) {
    try {
      hosted.push(await createImageFromUrl(url));
    } catch (e) {
      throw new Error(`eBay didn't take photo ${hosted.length + 1}: ${(e as Error).message}`);
    }
  }
  return { urls: hosted, via: "media-api" };
}
