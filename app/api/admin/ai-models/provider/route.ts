// GET/PUT /api/admin/ai-models/provider — server-side proxy to the AI
// Gateway's Claude-direct switch (GET/PUT /provider on the worker) and its
// list of usable Claude models (GET /provider/models). Like the routing
// proxy next door, the gateway ADMIN_TOKEN stays server-side and this
// route sits behind the normal admin session.
//
// Claude direct: while on, the gateway sends chat requests straight to
// Anthropic (drawing on the Claude plan's monthly API credit) instead of
// OpenRouter, and falls back to OpenRouter on any Anthropic error.
//
// Env: AI_GATEWAY_URL, AI_GATEWAY_TOKEN, AI_GATEWAY_ADMIN_TOKEN (same as
// /api/admin/ai-models).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderUpdate = {
  anthropic?: boolean;
  cheap?: string;
  standard?: string;
  map?: Record<string, string>;
};

function env() {
  const url = process.env.AI_GATEWAY_URL?.replace(/\/+$/, "");
  const appToken = process.env.AI_GATEWAY_TOKEN;
  const adminToken = process.env.AI_GATEWAY_ADMIN_TOKEN;
  if (!url || !appToken || !adminToken) {
    throw new Error(
      "AI_GATEWAY_URL / AI_GATEWAY_TOKEN / AI_GATEWAY_ADMIN_TOKEN must all be set."
    );
  }
  return { url, appToken, adminToken };
}

async function gatewayError(res: Response, what: string) {
  const t = await res.text();
  // A 404 here means the worker predates the Claude-direct switch.
  const hint =
    res.status === 404
      ? " The gateway worker needs redeploying (npx wrangler deploy in the ai-gateway folder)."
      : "";
  return NextResponse.json(
    { error: `Gateway ${what} ${res.status}: ${t.slice(0, 200)}${hint}` },
    { status: 502 }
  );
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let cfg;
  try {
    cfg = env();
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }

  const [stateRes, modelsRes] = await Promise.all([
    fetch(`${cfg.url}/provider`, {
      headers: { Authorization: `Bearer ${cfg.adminToken}` },
      cache: "no-store",
    }),
    fetch(`${cfg.url}/provider/models`, {
      headers: { Authorization: `Bearer ${cfg.appToken}` },
      cache: "no-store",
    }),
  ]);
  if (!stateRes.ok) return gatewayError(stateRes, "/provider");
  const state = await stateRes.json();

  // The model list is nice-to-have; degrade gracefully if it fails.
  let models: Array<{ id: string; name?: string }> = [];
  let modelsError: string | undefined;
  if (modelsRes.ok) {
    const data = (await modelsRes.json()) as { models?: typeof models; error?: string };
    models = data.models ?? [];
    modelsError = data.error;
  } else {
    modelsError = `Gateway /provider/models ${modelsRes.status}`;
  }

  return NextResponse.json({ state, models, modelsError });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let cfg;
  try {
    cfg = env();
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }

  let body: ProviderUpdate;
  try {
    body = (await req.json()) as ProviderUpdate;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Send only well-formed fields; the gateway keeps whatever is left out.
  const clean: ProviderUpdate = {};
  if (typeof body.anthropic === "boolean") clean.anthropic = body.anthropic;
  if (typeof body.cheap === "string" && body.cheap.trim()) clean.cheap = body.cheap.trim();
  if (typeof body.standard === "string" && body.standard.trim()) clean.standard = body.standard.trim();
  if (body.map && typeof body.map === "object" && !Array.isArray(body.map)) {
    clean.map = {};
    for (const [k, v] of Object.entries(body.map)) {
      if (typeof v === "string" && k.trim() && v.trim()) clean.map[k.trim()] = v.trim();
    }
  }
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const resp = await fetch(`${cfg.url}/provider`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.adminToken}`,
    },
    body: JSON.stringify(clean),
  });
  if (!resp.ok) return gatewayError(resp, "/provider");
  return NextResponse.json({ ok: true, state: await resp.json() });
}
