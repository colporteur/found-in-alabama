// fia-inbox — Cloudflare Email Worker for the Found in Alabama site inbox
// (Phase MAIL-1). Email Routing rules for "Site inbox" addresses point at
// this worker. It POSTs the raw message to the site, which stores it and
// answers whether to also forward it.
//
// Paste into Cloudflare → Workers & Pages → fia-inbox → Edit code, or
// deploy with wrangler. No dependencies.
//
// Worker settings → Variables:
//   INBOUND_SECRET   (secret)  same value as EMAIL_INBOUND_SECRET in Vercel
//   FALLBACK_FORWARD (text)    e.g. colporteurbooks@gmail.com — a VERIFIED
//                              Email Routing destination. Used when the
//                              site is down or a message is too large, so
//                              mail is never lost.
//   INBOUND_URL      (text, optional)
//                    default https://www.foundinalabama.com/api/email/inbound

const DEFAULT_URL = "https://www.foundinalabama.com/api/email/inbound";
// Vercel caps function request bodies at ~4.5 MB.
const MAX_POST_BYTES = 4_000_000;

function headersOnly(message) {
  let out = "";
  for (const [k, v] of message.headers) out += `${k}: ${v}\r\n`;
  return out + "\r\n";
}

export default {
  async email(message, env, ctx) {
    const endpoint = env.INBOUND_URL || DEFAULT_URL;
    const fallback = env.FALLBACK_FORWARD || null;
    const tooLarge = message.rawSize > MAX_POST_BYTES;

    const body = tooLarge
      ? headersOnly(message)
      : await new Response(message.raw).arrayBuffer();

    let decision = null;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.INBOUND_SECRET}`,
          "Content-Type": "message/rfc822",
          "X-Envelope-To": message.to,
          "X-Envelope-From": message.from,
          "X-Raw-Size": String(message.rawSize),
          "X-Truncated": tooLarge ? "1" : "0",
        },
        body,
      });
      if (res.ok) decision = await res.json();
      else console.log(`site returned ${res.status}: ${await res.text()}`);
    } catch (err) {
      console.log(`site unreachable: ${err}`);
    }

    // Site answered → do what it says. Site failed → fallback forward.
    let forwardTo = decision ? decision.forwardTo || null : fallback;
    // An oversized message only exists in full if we forward it somewhere.
    if (tooLarge && !forwardTo) forwardTo = fallback;

    if (forwardTo) {
      try {
        await message.forward(forwardTo);
        return;
      } catch (err) {
        console.log(`forward to ${forwardTo} failed: ${err}`);
      }
    }
    if (!decision || !decision.stored) {
      // Nothing stored and nothing forwarded: bounce so the sender knows.
      message.setReject("Temporarily unable to deliver; please try again later.");
    }
  },
};
