// Posting schedule — Phase A of social automation.
//
// Encodes the per-channel posting plan from docs/social-posting-plan.md:
// which days each channel posts, the time window (US Central), and caps.
// nextSlotFor() finds the next open slot for a channel given what's
// already scheduled, so drafts can be auto-assigned a scheduledFor
// without piling up on the same hour.
//
// All wall-clock times are America/Chicago (handles CST/CDT shifts via
// Intl); stored timestamps are UTC Dates.

import type { ChannelKey } from "@/lib/social/channel-styles";

export type ChannelSchedule = {
  /** Days of week allowed, 0=Sunday … 6=Saturday (Central time). */
  days: number[];
  /** Posting window start/end, 24h "HH:MM" Central time. */
  windowStart: string;
  windowEnd: string;
  /** Max posts per Central-time calendar day. */
  perDayCap: number;
  /**
   * Stagger: when several channels are scheduled for the same item
   * (generation), this channel's slot search starts N days after the
   * first channel's. Implements the plan's "Pinterest immediately,
   * other channels over 1-3 days" rotation.
   */
  staggerDays: number;
};

// From docs/social-posting-plan.md §2 (weekly grid).
export const POSTING_SCHEDULE: Record<ChannelKey, ChannelSchedule> = {
  instagram_feed: {
    days: [2, 3, 5, 6], // Tue, Wed, Fri, Sat
    windowStart: "12:00",
    windowEnd: "15:00",
    perDayCap: 1,
    staggerDays: 2,
  },
  instagram_story: {
    days: [1, 2, 3, 4, 5, 6], // Mon–Sat
    windowStart: "09:00",
    windowEnd: "19:00",
    perDayCap: 2,
    staggerDays: 0,
  },
  facebook: {
    days: [1, 3, 4, 6], // Mon, Wed, Thu, Sat
    windowStart: "09:00",
    windowEnd: "12:00",
    perDayCap: 1,
    staggerDays: 1,
  },
  twitter: {
    days: [1, 2, 3, 4, 5], // Mon–Fri
    windowStart: "12:00",
    windowEnd: "14:00",
    perDayCap: 1,
    staggerDays: 0,
  },
  pinterest: {
    days: [1, 2, 3, 4, 5, 6], // Mon–Sat (timing barely matters; search-driven)
    windowStart: "10:00",
    windowEnd: "13:00",
    perDayCap: 1,
    staggerDays: 0,
  },
  bluesky: {
    days: [1, 2, 3, 4, 5], // Mon–Fri
    windowStart: "09:00",
    windowEnd: "11:00",
    perDayCap: 1,
    staggerDays: 1,
  },
};

const TZ = "America/Chicago";

/** Minutes of UTC offset for America/Chicago at a given instant (negative = behind UTC). */
function chicagoOffsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    timeZoneName: "shortOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  // e.g. "GMT-5" or "GMT-6"
  const m = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -300; // sane fallback: CDT
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

/** Build a UTC Date for a Central wall-clock time on a given Central calendar date. */
function centralDateTime(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number
): Date {
  // First guess assumes the offset at the corresponding UTC instant;
  // re-derive once to handle DST boundary days correctly.
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  for (let i = 0; i < 2; i++) {
    const offset = chicagoOffsetMinutes(guess);
    guess = new Date(
      Date.UTC(year, month - 1, day, hour, minute) - offset * 60_000
    );
  }
  return guess;
}

/** Central-time calendar parts for a UTC instant. */
function centralParts(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    weekday: weekdays.indexOf(parts.weekday),
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
  };
}

/** "YYYY-M-D" key for the Central calendar day containing a UTC instant. */
export function centralDayKey(at: Date): string {
  const p = centralParts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return { h, m };
}

/**
 * Find the next open posting slot for a channel.
 *
 * @param channel       which channel
 * @param existing      scheduledFor timestamps already taken for this channel
 *                      (future, statuses scheduled — pass posted-today too if
 *                      you want the per-day cap to count them)
 * @param notBefore     earliest acceptable instant (defaults to now); use
 *                      stagger offsets for multi-channel item rollouts
 * @returns a UTC Date inside the channel's next open window, or null if no
 *          slot exists within 30 days (caps full — effectively never).
 */
export function nextSlotFor(
  channel: ChannelKey,
  existing: Date[],
  notBefore: Date = new Date()
): Date | null {
  const cfg = POSTING_SCHEDULE[channel];
  if (!cfg) return null;

  const takenByDay = new Map<string, Date[]>();
  for (const d of existing) {
    const key = centralDayKey(d);
    const arr = takenByDay.get(key) ?? [];
    arr.push(d);
    takenByDay.set(key, arr);
  }

  const start = parseHHMM(cfg.windowStart);
  const end = parseHHMM(cfg.windowEnd);
  const windowMinutes =
    end.h * 60 + end.m - (start.h * 60 + start.m);

  // Walk forward day by day (Central calendar) for up to 30 days.
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const probe = new Date(notBefore.getTime() + dayOffset * 86_400_000);
    const p = centralParts(probe);
    if (!cfg.days.includes(p.weekday)) continue;

    const dayKey = `${p.year}-${p.month}-${p.day}`;
    const taken = takenByDay.get(dayKey) ?? [];
    if (taken.length >= cfg.perDayCap) continue;

    const windowOpen = centralDateTime(p.year, p.month, p.day, start.h, start.m);
    const windowClose = centralDateTime(p.year, p.month, p.day, end.h, end.m);

    // Earliest instant we may schedule on this day.
    const floor = new Date(
      Math.max(windowOpen.getTime(), notBefore.getTime())
    );
    if (floor.getTime() >= windowClose.getTime()) continue; // window already past

    // Pick a deterministic-ish but spread-out minute: hash on day + count
    // of taken slots, so multiple drafts the same day don't collide.
    const usable = windowClose.getTime() - floor.getTime();
    const seed = (p.day * 7 + p.month * 31 + taken.length * 13) % 17;
    const offsetMs = Math.min(
      usable - 60_000,
      Math.floor((seed / 17) * usable)
    );
    let slot = new Date(floor.getTime() + Math.max(0, offsetMs));

    // Keep 30 minutes clearance from other slots that day.
    const tooClose = (d: Date) =>
      Math.abs(d.getTime() - slot.getTime()) < 30 * 60_000;
    let guard = 0;
    while (taken.some(tooClose) && guard < 10) {
      slot = new Date(
        Math.min(slot.getTime() + 35 * 60_000, windowClose.getTime() - 60_000)
      );
      guard++;
    }
    if (taken.some(tooClose)) continue; // day too crowded; next day

    return slot;
  }
  return null;
}

/** Suggested per-channel ordering + stagger when scheduling one item across channels. */
export function staggerFor(channel: ChannelKey): number {
  return POSTING_SCHEDULE[channel]?.staggerDays ?? 0;
}

/**
 * Channels paused via env (comma-separated SOCIAL_DISABLED_CHANNELS,
 * e.g. "pinterest" while its API approval is pending). Auto-generation
 * skips them and the scheduler leaves their existing drafts untouched —
 * unset the var and everything resumes.
 */
export function disabledChannels(): Set<string> {
  return new Set(
    (process.env.SOCIAL_DISABLED_CHANNELS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}
