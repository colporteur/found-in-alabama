// POST /api/admin/newsletter/draft/generate
// Body (optional): { windowDays?: number, label?: string }
//
// Collects facts, then asks Claude — IN PARALLEL — for each flavor.
// Splitting cuts per-call output in half so each call comfortably
// finishes within Vercel's 60s gateway. Both calls share the same facts.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterDrafts, newsletterSubscribers } from "@/db";
import { eq, count } from "drizzle-orm";
import { DRAFT_MODEL } from "@/lib/claude";
import { gatewayMessages } from "@/lib/gateway";
import { collectNewsletterFacts } from "@/lib/newsletter/data";
import {
  buildEmailSystemPrompt,
  buildEbaySystemPrompt,
  buildUserMessage,
} from "@/lib/newsletter/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type FlavorOutput = {
  subject: string;
  body: string;
};

function defaultLabel(): string {
  const now = new Date();
  return `${now.toLocaleString("en-US", { month: "long", year: "numeric" })} newsletter`;
}

async function callClaudeForFlavor({
  systemPrompt,
  userMessage,
  flavor,
}: {
  systemPrompt: string;
  userMessage: string;
  flavor: "email" | "ebay";
}): Promise<FlavorOutput> {
  const response = await gatewayMessages({
    model: DRAFT_MODEL,
    max_tokens: 5000, // Sonnet 5: absorb tokenizer + thinking; stays under 60s gateway when paralleled
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`${flavor} flavor: Claude returned no text content`);
  }
  const raw = block.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let parsed: FlavorOutput;
  try {
    parsed = JSON.parse(raw) as FlavorOutput;
  } catch {
    throw new Error(
      `${flavor} flavor: Claude returned non-JSON output. First 300 chars: ${raw.slice(0, 300)}`
    );
  }
  if (!parsed.subject?.trim() || !parsed.body?.trim()) {
    throw new Error(`${flavor} flavor: Claude omitted subject or body`);
  }
  return {
    subject: parsed.subject.trim(),
    body: parsed.body.trim(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { windowDays?: number; label?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // empty body is fine
    }
    const windowDays =
      body.windowDays && body.windowDays > 0 && body.windowDays <= 180
        ? body.windowDays
        : 30;
    const label = body.label?.trim() || defaultLabel();

    // 1. Collect facts (one DB read)
    const facts = await collectNewsletterFacts({ windowDays });
    const userMessage = buildUserMessage(facts);

    // 2. Two Claude calls in PARALLEL — one per flavor. Slowest of the
    //    two governs total time; previously we were asking for both
    //    flavors in a single 6000-token call which often exceeded 60s.
    const [emailOut, ebayOut] = await Promise.all([
      callClaudeForFlavor({
        systemPrompt: buildEmailSystemPrompt(),
        userMessage,
        flavor: "email",
      }),
      callClaudeForFlavor({
        systemPrompt: buildEbaySystemPrompt(),
        userMessage,
        flavor: "ebay",
      }),
    ]);

    // 3. Count current confirmed subscribers
    const [emailCount] = await db
      .select({ n: count() })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.status, "confirmed"));

    // 4. Save draft
    const [saved] = await db
      .insert(newsletterDrafts)
      .values({
        label,
        emailSubject: emailOut.subject,
        ebaySubject: ebayOut.subject,
        emailBody: emailOut.body,
        ebayBody: ebayOut.body,
        factsSnapshot: facts as unknown as Record<string, unknown>,
        emailRecipientCount: Number(emailCount?.n ?? 0),
      })
      .returning();

    return NextResponse.json({ draft: saved });
  } catch (err) {
    console.error("[newsletter/draft/generate]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : "Unexpected server error generating draft",
      },
      { status: 500 }
    );
  }
}
