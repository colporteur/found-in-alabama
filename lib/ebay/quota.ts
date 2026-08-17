// eBay API call-ceiling detection.
//
// eBay enforces two separate limits that both surface as ordinary call
// failures:
//
//   - A per-window rate limit on Revise Listing calls (ReviseItem,
//     ReviseFixedPriceItem, ...) — ErrorCode 21919144. Clears in
//     seconds to minutes.
//   - A daily application-aggregate limit, 5,000 calls/day by default —
//     ErrorCode 518, "Call usage limit has been reached". Clears at
//     eBay's daily reset. A higher ceiling requires an Application
//     Growth Check request in the developer portal.
//
// Either one means every subsequent call fails identically, so bulk
// runners must STOP rather than march through the queue converting a
// temporary ceiling into hundreds of permanent-looking failures (and, for
// the AI categorizer, burning an LLM call per item on the way).

export function isQuotaError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    // Deliberately narrow. This predicate halts entire batch runs, and
    // the enhance queue applies it to failures from every op — including
    // AI providers, whose 429s say "You exceeded your current quota".
    // Matching on generic phrases like "exceeded your" would let one
    // OpenRouter rate-limit stop the whole tick as an eBay quota event.
    m.includes("exceeded the number of calls") ||
    m.includes("exceeded the maximum number of calls") ||
    m.includes("call usage limit") ||
    m.includes("maximum call limit") ||
    m.includes("exceeded your call") ||
    msg.includes("21919144") ||
    msg.includes("21917053") ||
    /\berrorcode[^0-9]{0,3}518\b/i.test(msg)
  );
}
