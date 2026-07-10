// POST /api/admin/draft/transcribe — audio → transcript → smart-filled
// haul-draft fields.
//
// Two steps:
//   1. OpenAI gpt-4o-mini-transcribe (~$0.003/min) turns the recording
//      into text. Audio is never stored — transcript only.
//   2. A Haiku pass splits the transcript into the draft form's fields
//      (acquisition story, photo notes, city/state/vague location).
//      Split-only: it may trim filler words but must not add facts —
//      the transcript is Todd's own ground truth and feeds the
//      strictly-grounded haul generator downstream.
//
// Body: multipart/form-data with an "audio" file. Vercel's ~4.5MB body
// cap ≈ 4-5 minutes of AAC — the client warns near the limit.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { gatewayMessages } from "@/lib/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"; // direct OpenAI (audio API isn't proxied by OpenRouter)
// Gateway alias — actual model set in the gateway routing table
// (Admin → AI Models). Seeded to anthropic/claude-haiku-4.5.
const SPLIT_MODEL = "fia-cheap";
const MAX_BYTES = 4_200_000;

const SPLIT_SYSTEM = `You organize a reseller's spoken haul notes into form fields. The speaker runs "Found in Alabama" and has just recorded themselves describing a haul (estate sale, auction, thrift find).

Return ONLY a JSON object with these keys (use "" when the transcript doesn't cover a field):
- acquisitionStory: where/how the haul was acquired — the source, the circumstances, timing, people mentioned. Written as clean prose in the speaker's own words and voice.
- photoNotes: the ITEMS mentioned — what came home. A compact run-through of the objects, brands, quantities the speaker named.
- city: a city/town name ONLY if the speaker explicitly said one.
- state: a US state ONLY if explicitly said (default "" — do not assume Alabama).
- vagueLocation: a looser locale if given ("northeast Alabama", "off Highway 21").

Rules: split and lightly clean (drop ums, false starts, repeated words) but NEVER add, infer, or embellish facts. Keep the speaker's phrasing where possible. No commentary, no code fences.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set in the environment" },
      { status: 500 }
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No audio file received" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio is ${(file.size / 1_000_000).toFixed(1)}MB — keep recordings under ~4 minutes` },
      { status: 400 }
    );
  }

  // ── Step 1: transcribe ──
  const upstream = new FormData();
  upstream.append(
    "file",
    new Blob([await file.arrayBuffer()], { type: file.type || "audio/mp4" }),
    file.name || "haul-story.m4a"
  );
  upstream.append("model", TRANSCRIBE_MODEL);

  const tRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: upstream,
  });
  if (!tRes.ok) {
    const detail = await tRes.text();
    return NextResponse.json(
      { error: `Transcription failed (${tRes.status}): ${detail.slice(0, 300)}` },
      { status: 502 }
    );
  }
  const tData = (await tRes.json()) as { text?: string };
  const transcript = (tData.text ?? "").trim();
  if (!transcript) {
    return NextResponse.json(
      { error: "Transcription came back empty — try re-recording" },
      { status: 502 }
    );
  }

  // ── Step 2: smart-fill split (Haiku) ──
  let fields = {
    acquisitionStory: transcript, // fallback: verbatim into the story box
    photoNotes: "",
    city: "",
    state: "",
    vagueLocation: "",
  };
  try {
    const resp = await gatewayMessages({
      model: SPLIT_MODEL,
      max_tokens: 1500,
      system: SPLIT_SYSTEM,
      messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
    });
    const text = resp.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      const s = (k: string) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "");
      // Only accept the split if it actually produced a story.
      if (s("acquisitionStory")) {
        fields = {
          acquisitionStory: s("acquisitionStory"),
          photoNotes: s("photoNotes"),
          city: s("city"),
          state: s("state"),
          vagueLocation: s("vagueLocation"),
        };
      }
    }
  } catch (err) {
    // Split is best-effort — verbatim transcript still gets returned.
    console.warn("[transcribe] smart-fill split failed:", err);
  }

  return NextResponse.json({ transcript, fields });
}
