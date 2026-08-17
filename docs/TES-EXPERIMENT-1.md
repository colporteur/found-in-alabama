# TES Experiment 1 — Does Nifty react when an eBay listing ends without a sale?

*The Ephemeral State project · drafted 2026-08-15*

## Why we're running this

When something sells on theephemeralstate.com, we need it delisted from eBay and
every other Nifty-connected marketplace. The dream path is: our site ends the
eBay listing via the Trading API, and Nifty notices and delists everywhere else.

**Expectation check (from Nifty's own docs, read 2026-08-15):** Nifty says
auto-delisting is triggered by *detected sales only* — "if a seller manually
ends a listing without a sale, auto-delisting doesn't trigger," and sales are
detected within a fixed ~15-minute window. So the dream path is probably dead
on arrival. We're running the experiment anyway because docs simplify: some
crosslisters surface a *reconciliation prompt* ("this listing ended on eBay —
delist elsewhere?") even when they don't fully automate it. A prompt would be
nearly as good — one click for you, or one click for the extension.

## What we'll learn

One of three outcomes, each mapping to a different architecture for the
"sold on our site → delist everywhere" direction:

| Outcome | What it means | What we build |
|---------|---------------|---------------|
| A. Nifty auto-delists the other marketplaces | Docs were conservative; ended = sold as far as Nifty cares | Site calls eBay `EndItem`; no Nifty automation at all |
| B. Nifty flags/prompts but doesn't act | Semi-automatic path exists | Site ends eBay listing + queue portal; you (or the extension) click the prompt |
| C. Nifty does nothing | Docs were accurate | Chrome extension delists via Nifty's own UI (Nifty then removes it everywhere, including eBay) |

Even outcome C is fine — the extension actuator is a pattern we've built twice —
but we should know which world we're in before writing any of it.

## Picking the sacrificial item

- Low value (~$10 or less) — worst case is relisting cost/hassle, but pick
  something you wouldn't cry over if it got messy.
- Quantity 1, fixed-price (BIN), no active offers, no watchers ideally.
- **Crosslisted via Nifty to at least Poshmark plus one more venue** — we need
  live listings elsewhere to observe. Poshmark is the best observation target
  (we can verify its listing state from the outside, per the invoice project).
- Confirm auto-delisting is actually enabled in Nifty for your account and for
  the marketplaces involved (Settings → Auto-Delisting). If it's off, the
  experiment can't distinguish B from C.

## Steps

1. **Record the before-state.** In Nifty, open the item; screenshot its
   marketplace badges (which venues show it live). Note the eBay item ID.
   Optionally open the Poshmark listing in a tab.
2. **End the eBay listing** in Seller Hub (Active listings → End listing →
   reason "No longer available"). Do it manually — no code needed; Nifty can't
   tell a Seller Hub end from an API `EndItem`, so this is a faithful proxy
   for what the site would do. Note the exact time.
3. **Watch Nifty at ~20 min, ~1 h, ~4 h, and ~24 h:**
   - The **Sale Detection Tracker** (Auto-Delisting section) — does a row
     appear for this item? What's its "Auto-delist status"?
   - The item's page in Nifty inventory — do the other marketplace badges
     change? Any banner, warning, or "needs attention" flag?
   - Any Nifty email/notification about the item.
   - The Poshmark listing — still live?
4. **Record the outcome** (A, B, or C above) and any screenshots of prompts —
   if B, the exact wording and where the prompt lives matters for automation.

## Cleanup (after ~24 h, or sooner if the outcome is clear)

- If the other listings are still live (B or C): delist the item **from
  Nifty's UI** ("delist everywhere") — this doubles as a bonus observation of
  exactly what the extension would automate in outcome C: note the clicks it
  takes and whether eBay-side anything errors (the eBay listing is already
  ended, which is exactly the state a real site-sale would leave).
- Relist whenever convenient: Sell Similar on eBay, re-import/crosslist in
  Nifty as usual.

## While the clock runs

The 24-hour observation window doesn't block anything. Catalog v1 (eBay
category → site sync, hostname routing for theephemeralstate.com) needs no
delisting machinery, so we build that in parallel.

One latency fact worth recording for later design: Nifty detects real sales
within ~15 minutes (fixed, can't be shortened). So in the reverse direction
(item sells on Poshmark → Nifty ends the eBay listing), our site's view of
eBay lags a real sale by up to ~15 min plus our own eBay poll interval. That
bounds how fresh the catalog can ever be, and later, checkout will need a
live eBay re-check at buy time regardless.
