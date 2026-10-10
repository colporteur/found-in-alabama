// Who bought it — read from the sale emails Phase 2 already stores, so the
// to-ship queue can name the buyer on invoices and spot two sales to the same
// person (one package). Pure; tested in buyers.test.mts with made-up samples
// (the repo is public: no real buyer data in fixtures).
//
//   Poshmark  subject: "\"<title>\" just sold to @buyer on Poshmark!"
//   Depop     subject: "Your USPS shipping label and sale confirmation for @buyer."
//             body:    "… Ship to <Name> <street…> Buyer <buyer> …"
//   Mercari / Whatnot: no buyer in the email — combine those by hand.

export type EmailBuyer = {
  username: string | null;
  name: string | null;
  /** Flattened ship-to text as the email shows it (Depop). */
  shipToText: string | null;
};

export function flattenHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[͏­​-‏⁠﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HANDLE = "[A-Za-z0-9_.-]{2,40}";

export function parseEmailBuyer(venue: string, subject: string | null, html: string | null, text?: string | null): EmailBuyer {
  const subj = subject ?? "";
  const out: EmailBuyer = { username: null, name: null, shipToText: null };
  if (venue === "poshmark") {
    const m = subj.match(new RegExp(`just sold to @(${HANDLE}) on Poshmark`, "i"));
    if (m) out.username = m[1];
    return out;
  }
  if (venue === "depop") {
    const m = subj.match(new RegExp(`sale confirmation for @(${HANDLE}?)\\.?\\s*$`, "i"));
    if (m) out.username = m[1].replace(/\.$/, "");
    const body = flattenHtml(html) || (text ?? "");
    const ship = body.match(/Ship to (.{2,60}?) (\d[\s\S]{4,160}?) Buyer (\S{2,40})/);
    if (ship) {
      out.name = ship[1].trim();
      out.shipToText = `${ship[1].trim()}, ${ship[2].trim()}`;
      if (!out.username) out.username = ship[3];
    }
    return out;
  }
  return out;
}
