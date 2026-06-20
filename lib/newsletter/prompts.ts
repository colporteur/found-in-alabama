// System + user prompts for the newsletter draft generator. One Claude
// call returns BOTH flavors (cross-marketplace + eBay-only) so they
// share voice without two round-trips.
//
// Strict fact-grounding: Claude is told to use ONLY the supplied data,
// to omit any section without facts, and never invent details. Voice
// samples come from the most recent haul bodies — same approach as the
// social copy work.

import type { NewsletterFacts } from "@/lib/newsletter/data";

const VOICE_RULES = `# Voice

You are writing for "Found in Alabama," a small Alabama-based reseller of estate finds, vintage, books, ephemera, and small antiques. The voice is warm, matter-of-fact, lightly editorial, with a hint of curator's pride. Like a thoughtful shopkeeper writing once a month to people who care what walked in the door.

DO:
- Stay close to the supplied facts. If something isn't in the data, do not write it.
- Use specific names, eras, places, materials when the data provides them.
- Use first-person plural ("we found...", "we packed out...").
- Sound like a person, not a brand voice. Short sentences welcome.

DON'T:
- Invent items, prices, hauls, or stories that aren't in the data.
- Use marketing fluff ("amazing finds," "don't miss," "act now").
- Add exclamation points to sales pitches.
- Repeat the same opener pattern across sections.
- Write sections about content that has zero supplied facts — just omit those sections.`;

const STRUCTURE_RULES = `# Newsletter structure

Both flavors share the same section structure but link readers to different places. The sections, in order:

1. Recent hauls — when there are recent hauls in the data
2. Now available — when there are featured active items
3. Recently sold — when there are recently sold items (a "look what found a home" tone, never gloating)
4. Active sales — when ebay_sales status=RUNNING are present
5. Upcoming sales — when ebay_sales status=SCHEDULED are present

If a section's data array is empty, OMIT that section entirely. Do not write filler text or apologies.`;

const LINK_RULES = `# Per-flavor link rules

You'll produce TWO flavors of the same newsletter:

## email flavor (for subscribers on our own list)
- Item links go to the product page URL on foundinalabama.com (data.productUrl). On that page buyers can see all marketplace options.
- Haul links go to the journal URL on foundinalabama.com (data.url).
- Mention the marketplaces an item is on by name in body text (eBay, Etsy, Poshmark, Mercari, Depop, Whatnot) — but the actual hyperlink is the product page.

## ebay flavor (paste into eBay Seller Hub email tool)
- Item links: use the eBay marketplace URL only (data.marketplaceUrls.ebay). If an item has NO eBay URL, omit it from this flavor entirely.
- Haul links: skip them. eBay subscribers want listings, not journal posts. You may mention a haul in passing for context.
- Do NOT link to foundinalabama.com or to other marketplaces. eBay's email tool rejects external links to competitors.`;

const MARKDOWN_RULES = `# Output format

Return a single JSON object with these exact keys:

{
  "emailSubject": "...",      // <= 70 chars, intriguing not clickbait
  "ebaySubject": "...",       // <= 70 chars, item/sale focused
  "emailBody": "...",         // markdown
  "ebayBody": "..."           // markdown
}

Markdown rules:
- Use ## for section headings (e.g. "## Recent hauls")
- Use - for bulleted item lists
- Use [text](url) for links — never bare URLs
- Keep paragraphs short (2–3 sentences max)
- No HTML
- No images (the data passed to you includes hero image URLs but readers will see those rendered separately; do not embed image markdown)
- No tables

Return ONLY the JSON. No code fences, no preamble.`;

export function buildSystemPrompt(): string {
  return `You draft monthly newsletters for "Found in Alabama," a small reseller. Your only job is to take the supplied data and write a tight, factual newsletter in two flavors. You do not invent.

${VOICE_RULES}

${STRUCTURE_RULES}

${LINK_RULES}

${MARKDOWN_RULES}`;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "(unknown)";
  return String(n);
}

function fmtPrice(p: string | null | undefined): string {
  if (!p) return "(price not recorded)";
  return `$${p}`;
}

export function buildUserMessage(facts: NewsletterFacts): string {
  const sections: string[] = [];

  sections.push(
    `This newsletter covers activity from the last ${facts.windowDays} days. Default location hint for "Found in ..." phrasing: ${facts.defaultLocationHint ?? "Alabama"}.`
  );

  // Recent hauls
  if (facts.recentHauls.length > 0) {
    sections.push(
      `## Recent hauls (${facts.recentHauls.length})\n` +
        facts.recentHauls
          .map(
            (h, i) =>
              `### Haul ${i + 1}\nTitle: ${h.title}\nDate: ${h.date}\nLocation: ${h.location ?? "(none)"}\nItems captured: ${h.itemCount} (${h.activeCount} available, ${h.soldCount} sold)\nJournal URL: ${h.url}\nExcerpt: ${h.excerpt || "(none)"}\nBody (first 1200 chars):\n${h.body}`
          )
          .join("\n\n")
    );
  } else {
    sections.push(`## Recent hauls\n(none in the window — omit this section in the newsletter)`);
  }

  // Featured active items
  if (facts.featuredActiveItems.length > 0) {
    sections.push(
      `## Featured active items (${facts.featuredActiveItems.length})\n` +
        facts.featuredActiveItems
          .map((it) => {
            const mps = Object.keys(it.marketplaceUrls).join(", ") || "(none recorded)";
            const hauls = it.haulTitle ? `From haul: "${it.haulTitle}"` : "";
            return `- "${it.title}" — ${fmtPrice(it.price)} — marketplaces: ${mps} — product URL: ${it.productUrl}${it.marketplaceUrls.ebay ? ` — eBay URL: ${it.marketplaceUrls.ebay}` : ""}${hauls ? ` — ${hauls}` : ""}`;
          })
          .join("\n")
    );
  } else {
    sections.push(`## Featured active items\n(none — omit this section)`);
  }

  // Recently sold items
  if (facts.recentlySoldItems.length > 0) {
    sections.push(
      `## Recently sold items (${facts.recentlySoldItems.length})\n` +
        facts.recentlySoldItems
          .map((it) => {
            const where = it.soldOnMarketplace ?? "(marketplace not recorded)";
            const hauls = it.haulTitle ? ` — from haul: "${it.haulTitle}"` : "";
            return `- "${it.title}" — sold for ${fmtPrice(it.price)} on ${where} on ${it.soldAt ?? "(date not recorded)"}${hauls}`;
          })
          .join("\n")
    );
  } else {
    sections.push(`## Recently sold items\n(none — omit this section)`);
  }

  // Active sales
  if (facts.activeSales.length > 0) {
    sections.push(
      `## Active sales (${facts.activeSales.length})\n` +
        facts.activeSales
          .map(
            (s) =>
              `- "${s.name}" (${s.saleType}, ${fmt(Number(s.discountPercent))}% off${s.minSpendAmount ? `, min spend $${s.minSpendAmount}` : ""}) — runs ${s.startsAt.slice(0, 10)} to ${s.endsAt.slice(0, 10)}${s.description ? ` — ${s.description}` : ""}`
          )
          .join("\n")
    );
  }

  // Upcoming sales
  if (facts.upcomingSales.length > 0) {
    sections.push(
      `## Upcoming sales (${facts.upcomingSales.length})\n` +
        facts.upcomingSales
          .map(
            (s) =>
              `- "${s.name}" (${s.saleType}, ${fmt(Number(s.discountPercent))}% off${s.minSpendAmount ? `, min spend $${s.minSpendAmount}` : ""}) — runs ${s.startsAt.slice(0, 10)} to ${s.endsAt.slice(0, 10)}${s.description ? ` — ${s.description}` : ""}`
          )
          .join("\n")
    );
  }

  sections.push(
    `\nGenerate both flavors of the newsletter as the JSON object specified. Use ONLY the facts above; do not invent items, prices, dates, or stories.`
  );

  return sections.join("\n\n");
}
