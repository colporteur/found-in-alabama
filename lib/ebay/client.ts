// Low-level eBay Trading API client. Uses Auth'n'Auth (single user token in
// .env.local), XML over HTTPS.
//
// Why Trading API and not the modern Sell APIs: the Sell API surface doesn't
// cleanly expose the seller's Store Category (StoreCategoryID /
// StoreCategory2ID) fields on listings. The Trading API does, and is still
// fully supported. ReviseItem with a Storefront block is the canonical way to
// re-assign the two store-category slots.
//
// Required env (see .env.example): EBAY_APP_ID, EBAY_DEV_ID, EBAY_CERT_ID,
// EBAY_AUTH_TOKEN, EBAY_ENV, EBAY_SITE_ID.

import { XMLBuilder, XMLParser } from "fast-xml-parser";

// API version compat level. Bumping this is safe — eBay maintains backward
// compatibility for years. As of mid-2025, 1349 is current.
const TRADING_API_VERSION = "1349";

interface EbayCreds {
  appId: string;
  devId: string;
  certId: string;
  authToken: string;
  env: "production" | "sandbox";
  siteId: string;
}

export function getEbayCreds(): EbayCreds {
  const required = [
    "EBAY_APP_ID",
    "EBAY_DEV_ID",
    "EBAY_CERT_ID",
    "EBAY_AUTH_TOKEN",
  ] as const;
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(
        `${key} is not set. Add it to .env.local — see PHASE-EBAY-1-SETUP.md.`
      );
    }
  }
  return {
    appId: process.env.EBAY_APP_ID!,
    devId: process.env.EBAY_DEV_ID!,
    certId: process.env.EBAY_CERT_ID!,
    authToken: process.env.EBAY_AUTH_TOKEN!,
    env: (process.env.EBAY_ENV as "production" | "sandbox") || "production",
    siteId: process.env.EBAY_SITE_ID || "0",
  };
}

function endpoint(env: "production" | "sandbox"): string {
  return env === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
  suppressEmptyNode: false,
  suppressBooleanAttributes: false,
});

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
});

export interface EbayCallOptions {
  /** Override the global site ID for a single call. */
  siteId?: string;
}

/**
 * Make a single Trading API call. `body` is built into the XML request after
 * the RequesterCredentials block.
 *
 * Returns the parsed `<{CallName}Response>` body. Throws on Ack=Failure with
 * the eBay LongMessage(s) joined.
 */
export async function tradingCall<T = Record<string, unknown>>(
  callName: string,
  body: Record<string, unknown> = {},
  opts: EbayCallOptions = {}
): Promise<T> {
  const creds = getEbayCreds();

  const requestPayload = {
    [`${callName}Request`]: {
      "@_xmlns": "urn:ebay:apis:eBLBaseComponents",
      RequesterCredentials: { eBayAuthToken: creds.authToken },
      ...body,
    },
  };

  const xml = `<?xml version="1.0" encoding="utf-8"?>\n${builder.build(
    requestPayload
  )}`;

  // Set EBAY_DEBUG=1 in env to log the request and response XML to the
  // server console. Useful for diagnosing schema-validation failures.
  if (process.env.EBAY_DEBUG === "1") {
    console.log(`[ebay:${callName}] >>> request body:\n${xml}`);
  }

  const response = await fetch(endpoint(creds.env), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-DEV-NAME": creds.devId,
      "X-EBAY-API-APP-NAME": creds.appId,
      "X-EBAY-API-CERT-NAME": creds.certId,
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": opts.siteId ?? creds.siteId,
    },
    body: xml,
    // Trading API can be slow on big responses (GetSellerList paginated).
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `eBay ${callName} HTTP ${response.status}: ${text.slice(0, 800)}`
    );
  }

  const xmlText = await response.text();
  if (process.env.EBAY_DEBUG === "1") {
    console.log(
      `[ebay:${callName}] <<< response body (first 2000 chars):\n${xmlText.slice(0, 2000)}`
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlText) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `eBay ${callName}: failed to parse response XML — ${
        (err as Error).message
      }; body starts: ${xmlText.slice(0, 300)}`
    );
  }

  const responseBody = parsed[`${callName}Response`] as
    | Record<string, unknown>
    | undefined;
  if (!responseBody) {
    throw new Error(
      `eBay ${callName}: no ${callName}Response in body — ${xmlText.slice(0, 500)}`
    );
  }

  const ack = responseBody.Ack;
  if (ack === "Failure" || ack === "PartialFailure") {
    const errors = responseBody.Errors;
    const errArr = Array.isArray(errors) ? errors : errors ? [errors] : [];
    const msg = errArr
      .map((e: Record<string, unknown>) => e.LongMessage || e.ShortMessage)
      .filter(Boolean)
      .join("; ");
    if (ack === "Failure") {
      throw new Error(`eBay ${callName} Failure: ${msg || "(no error detail)"}`);
    }
    // PartialFailure: log and continue. Caller can inspect responseBody.Errors.
    console.warn(`[ebay] ${callName} PartialFailure: ${msg}`);
  }

  return responseBody as T;
}
