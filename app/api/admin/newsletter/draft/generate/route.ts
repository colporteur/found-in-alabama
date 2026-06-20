// POST /api/admin/newsletter/draft/generate
// Body (optional): { windowDays?: number, label?: string }
// Returns: { draft: NewsletterDraft }
//
// Collects facts → asks Claude for both flavors → saves a new
// newsletter_drafts row → returns it. Admin then opens the draft editor
// to refine before sending.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, newsletterDrafts, newsletterSubscribers } from "@/db";
import { eq, count } from "drizzle-orm";
import { getClaude, DRAFT_MODEL } from "@/lib/claude";
import { collectNewsletterFacts } from "@/lib/newsletter/data";
import { buildSystemPrompt, buildUserMessage } from "@/lib/newsletter/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type ClaudeOutput = {
  emailSubject?: string;
  ebaySubject?: string;
  emailBody?: string;
  ebayBody?: string;
};

function defaultLabel(): string {
  const now = new Date();
  return `${now.toLocaleString("en-US", { month: "long", year: "numeric" })} newsletter`;
}

export async function POST(req: NextRequest) {
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
  const windowDays = body.windowDays && body.windowDays > 0 && body.windowDays <= 180
    ? body.windowDays
    : 30;
  const label = body.label?.trim() || defaultLabel();

  // 1. Collect facts
  const facts = await collectNewsletterFacts({ windowDays });

  // 2. Call Claude
  const claude = getClaude();
  let parsed: ClaudeOutput;
  try {
    const response = await claude.messages.create({
      model: DRAFT_MODEL,
      max_tokens: 4000,
      system: buildSystemPrompt(),
      messages: [
        { role: "user", content: buildUserMessage(facts) },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json(
        { error: "Claude returned no text content" },
        { status: 502 }
      );
    }
    const raw = block.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      parsed = JSON.parse(raw) as ClaudeOutput;
    } catch {
      return NextResponse.json(
        {
          error: "Claude returned non-JSON output",
          raw: raw.slice(0, 500),
        },
        { status: 502 }
      );
    }
  } catch (err) {
    console.error("[newsletter/draft/generate] Claude failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }

  const emailSubject = parsed.emailSubject?.trim() ?? label;
  const ebaySubject = parsed.ebaySubject?.trim() ?? label;
  const emailBody = parsed.emailBody?.trim();
  const ebayBody = parsed.ebayBody?.trim();
  if (!emailBody || !ebayBody) {
    return NextResponse.json(
      { error: "Claude omitted required body field(s)" },
      { status: 502 }
    );
  }

  // 3. Count current confirmed subscribers for the admin view
  const [emailCount] = await db
    .select({ n: count() })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.status, "confirmed"));

  // 4. Save draft
  const [saved] = await db
    .insert(newsletterDrafts)
    .values({
      label,
      emailSubject,
      ebaySubject,
      emailBody,
      ebayBody,
      factsSnapshot: facts as unknown as Record<string, unknown>,
      emailRecipientCount: Number(emailCount?.n ?? 0),
    })
    .returning();

  return NextResponse.json({ draft: saved });
}
