// Per-flavor newsletter prompts. Two separate Claude calls (one per
// flavor) run in parallel from the generate route. This halves
// per-call output size which keeps each call well under Vercel's 60s
// gateway timeout.
//
// Both flavors share the same fact-grounding philosophy and voice;
// they differ in link strategy and image policy.

import type { NewsletterFacts } from "@/lib/newsletter/data";

const SHARED_VOICE = `# Voice

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

const SHARED_STRUCTURE = `# Section structure

Sections, in order. If a section's data array is empty, OMIT the section entirely. Do not write filler text or apologies.

1. Recent hauls
2. Now available (featured active items)
3. Recently sold (a "look what found a home" tone — never gloating)
4. Active sales (status=RUNNING in the data)
5. Upcoming sales (status=SCHEDULED in the data)`;

const SHARED_MARKDOWN = `# Output format

Return a single JSON object with EXACTLY these keys, nothing else:

{
  "subject": "...",  // <= 70 chars
  "body": "..."      // markdown
}

Markdown rules:
- Use ## for section headings
- Use - for bulleted lists
- Use [text](url) for links — never bare URLs
- Keep paragraphs short (2–3 sentences max)
- No HTML, no tables

Return ONLY the JSON object. No code fences, no preamble.`;

// ─── Email flavor ──────────────────────────────────────────────────────

const EMAIL_LINKS_AND_IMAGES = `# Link + image rules (email flavor)

- Item links go to the product page URL on foundinalabama.com (data.productUrl). On that page buyers can see all marketplace options. Mention the marketplaces by name in body text (eBay, Etsy, Poshmark, Mercari, Depop, Whatnot).
- Haul links go to the journal URL on foundinalabama.com (data.url).
- IMAGES: include the haul hero image once per haul, immediately after the haul's heading. Use markdown image syntax: ![haul title](heroImage URL from the data). Skip a haul's image only if its heroImage field is null. Do NOT embed images for individual items.`;

export function buildEmailSystemPrompt(): string {
  return `You write the email flavor of a small reseller's monthly newsletter for "Found in Alabama." Use ONLY the supplied facts.

${SHARED_VOICE}

${SHARED_STRUCTURE}

${EMAIL_LINKS_AND_IMAGES}

${SHARED_MARKDOWN}`;
}

// ─── eBay flavor ───────────────────────────────────────────────────────

const EBAY_LINKS_NO_IMAGES = `# Link + image rules (eBay flavor — pasted into eBay Seller Hub email tool)

- Item links: use the eBay marketplace URL ONLY (data.marketplaceUrls.ebay). If an item has NO eBay URL in the data, omit it from this flavor entirely.
- Haul links: skip them. eBay subscribers want listings, not journal posts. You may mention a haul in passing for context.
- Do NOT link to foundinalabama.com or to any non-eBay marketplace. eBay's email tool rejects external links to competitors.
- IMAGES: do NOT include any markdown images. The Seller Hub email tool handles images via its own UI.`;

export function buildEbaySystemPrompt(): string {
  return `You write the eBay-Seller-Hub flavor of a small reseller's monthly newsletter for "Found in Alabama." Use ONLY the supplied facts.

${SHARED_VOICE}

${SHARED_STRUCTURE}

${EBAY_LINKS_NO_IMAGES}

${SHARED_MARKDOWN}`;
}

// ─── User message (shared facts payload) ───────────────────────────────

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

  if (facts.recentHauls.length > 0) {
    sections.push(
      `## Recent hauls (${facts.recentHauls.length})\n` +
        facts.recentHauls
          .map(
            (h, i) =>
              `### Haul ${i + 1}\nTitle: ${h.title}\nDate: ${h.date}\nLocation: ${h.location ?? "(none)"}\nItems captured: ${h.itemCount} (${h.activeCount} available, ${h.soldCount} sold)\nJournal URL: ${h.url}\nHero image URL: ${h.heroImage ?? "(none)"}\nExcerpt: ${h.excerpt || "(none)"}\nBody (first 1200 chars):\n${h.body}`
          )
          .join("\n\n")
    );
  } else {
    sections.push(`## Recent hauls\n(none in the window — omit this section in the newsletter)`);
  }

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
    `\nUse ONLY the facts above. Do not invent items, prices, dates, or stories.`
  );

  return sections.join("\n\n");
}
