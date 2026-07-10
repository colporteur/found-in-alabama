// GET/PUT /api/admin/ai-models — server-side proxy to the AI Gateway's
// routing-table admin endpoints, so the Admin → AI Models page can view
// and edit which real model each alias points at. The gateway ADMIN_TOKEN
// stays server-side (Vercel env); the browser only ever talks to this
// route, which is behind the normal admin session.
//
// Env:
//   AI_GATEWAY_URL          — same worker URL the app already calls
//   AI_GATEWAY_TOKEN        — app token (used for GET /models)
//   AI_GATEWAY_ADMIN_TOKEN  — admin token (used for GET/PUT /config)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Routing = {
  default: string;
  aliases: Record<string, string>;
  apps: Record<string, string>;
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

  const [configRes, modelsRes] = await Promise.all([
    fetch(`${cfg.url}/config`, {
      headers: { Authorization: `Bearer ${cfg.adminToken}` },
      cache: "no-store",
    }),
    fetch(`${cfg.url}/models`, {
      headers: { Authorization: `Bearer ${cfg.appToken}` },
      cache: "no-store",
    }),
  ]);

  if (!configRes.ok) {
    const t = await configRes.text();
    return NextResponse.json(
      { error: `Gateway /config ${configRes.status}: ${t.slice(0, 200)}` },
      { status: 502 }
    );
  }
  const routing = (await configRes.json()) as Routing;

  // Models list is nice-to-have; degrade gracefully if it fails.
  let models: Array<{
    id: string;
    name?: string;
    prompt_price?: string;
    completion_price?: string;
    vision?: boolean;
  }> = [];
  if (modelsRes.ok) {
    const data = (await modelsRes.json()) as { models?: typeof models };
    models = data.models ?? [];
  }

  return NextResponse.json({ routing, models });
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

  let body: Routing;
  try {
    body = (await req.json()) as Routing;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  // Validate shape before it can brick the routing table.
  if (typeof body.default !== "string" || !body.default.trim()) {
    return NextResponse.json(
      { error: "Routing table needs a non-empty default model." },
      { status: 400 }
    );
  }
  const clean: Routing = {
    default: body.default.trim(),
    aliases: {},
    apps: {},
  };
  for (const [k, v] of Object.entries(body.aliases ?? {})) {
    if (typeof v === "string" && k.trim() && v.trim()) clean.aliases[k.trim()] = v.trim();
  }
  for (const [k, v] of Object.entries(body.apps ?? {})) {
    if (typeof v === "string" && k.trim() && v.trim()) clean.apps[k.trim()] = v.trim();
  }

  const resp = await fetch(`${cfg.url}/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.adminToken}`,
    },
    body: JSON.stringify(clean),
  });
  if (!resp.ok) {
    const t = await resp.text();
    return NextResponse.json(
      { error: `Gateway /config ${resp.status}: ${t.slice(0, 200)}` },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, routing: clean });
}
