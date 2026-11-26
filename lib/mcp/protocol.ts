// Ask the business (Phase 5b): a minimal MCP server over Streamable HTTP,
// stateless, JSON responses only (no SSE, no sessions) — all the FIA
// connector needs: initialize, tools/list, tools/call, ping, plus
// resources/list and resources/read for the panels a tool can open
// (MCP Apps: a ui:// resource holding the panel's HTML).
// Pure: tools and resources are passed in, so it's testable (protocol.test.mts).

export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** false for the few tools that save something (listing drafts). */
  readOnly?: boolean;
  /** Sent as the tool's `_meta`. MCP Apps reads `ui.resourceUri` (the panel
   *  this tool opens) and `ui.visibility` (["app"] = only a panel may call it). */
  meta?: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

/** Something the client can read by URI. Used for panel HTML (ui://…). */
export type ResourceDef = {
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
  /** Sent as `_meta` on the list entry and on the content (MCP Apps: `ui.csp`). */
  meta?: Record<string, unknown>;
  read: () => Promise<string>;
};

/** A tool can return MCP content blocks directly (e.g. photos as images). */
export type RawContent = { __mcpContent: Array<Record<string, unknown>> };
export function rawContent(blocks: Array<Record<string, unknown>>): RawContent {
  return { __mcpContent: blocks };
}

/** A tool result with a short text for Claude and the full data for a panel
 *  (sent as `structuredContent`, which is what the panel draws from). */
export type PanelResult = { __mcpPanel: { text: string; data: Record<string, unknown> } };
export function panelResult(text: string, data: Record<string, unknown>): PanelResult {
  return { __mcpPanel: { text, data } };
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type RpcReply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export const SERVER_INFO = { name: "found-in-alabama", title: "Found in Alabama", version: "1.0.0" };

export const INSTRUCTIONS = `Read-only access to Found in Alabama (FIA), Todd's vintage/ephemera resale business (eBay, Mercari, Poshmark, Depop, Whatnot, Etsy, HipPostcard, and his own sites The Ephemeral State and Found in Alabama).
- Inventory lives in the item registry: one row per physical item with a bin SKU (the box it's stored in), status live/sold/draft/archived, and the venues it's listed on.
- Sales history comes from Nifty's records back to Aug 2025 plus FIA's own sale detection since Sep 2026. Sale prices are the sold price when known, otherwise the listed price at the time.
- Money after fees, postage and item cost (profit_month) only covers packages in FIA's to-ship queue, which starts Oct 9 2026.
- Dates are US Central. Buyer info is limited to usernames and city/state on purpose.
Nothing here can change anything; to act, Todd uses the FIA admin. The one exception, when Todd has turned it on for this connection: the listing_* tools let Claude write listing drafts he queued ("Send to Claude"), combine pieces he sent with "combine lots" on into one lot draft, and revise its own until he approves them; they go to his Review queue and are never approved, sent to Nifty or published from here. The lot_build_* tools sort a batch he sent to the Lot Builder (one item type he already knows is lot material): Claude identifies each piece, flags pulls and pieces needing a photo, and proposes lots; only Todd builds them, from the Lot Builder page. The same tools work a Preview session (a mixed batch he isn't optimistic about): Claude identifies and values each piece and sorts it into single listing / lot with this batch / lot pool / discard; nothing is pooled, discarded or queued until Todd applies the preview on its page. listing_review_panel shows the drafts Claude wrote to Todd in a panel beside the chat; from it he can ask for a fix (which arrives in listing_fixes), and he still approves only in the FIA admin. On those connections the guide_link_* tools also file sold and live items under the Expert Guide that covers them; that filing only feeds guide_results (Todd's own results per guide) and changes no listing, price or guide.`;

function ok(id: Rpc["id"], result: unknown): RpcReply {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function fail(id: Rpc["id"], code: number, message: string): RpcReply {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function handleOne(msg: Rpc, tools: ToolDef[], resources: ResourceDef[]): Promise<RpcReply | null> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return fail(msg?.id ?? null, -32600, "Invalid request");
  const isNotification = msg.id === undefined;
  const p = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const asked = String(p.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: resources.length
          ? { tools: { listChanged: false }, resources: {} }
          : { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return isNotification ? null : ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            title: t.title,
            readOnlyHint: t.readOnly !== false,
            destructiveHint: false,
            idempotentHint: t.readOnly !== false,
            openWorldHint: false,
          },
          ...(t.meta ? { _meta: t.meta } : {}),
        })),
      });
    case "resources/list":
      return ok(msg.id, {
        resources: resources.map((r) => ({
          uri: r.uri,
          name: r.name,
          ...(r.description ? { description: r.description } : {}),
          mimeType: r.mimeType,
          ...(r.meta ? { _meta: r.meta } : {}),
        })),
      });
    case "resources/read": {
      const res = resources.find((r) => r.uri === p.uri);
      if (!res) return fail(msg.id, -32002, `Resource not found: ${String(p.uri)}`);
      try {
        const text = await res.read();
        return ok(msg.id, {
          contents: [{ uri: res.uri, mimeType: res.mimeType, text, ...(res.meta ? { _meta: res.meta } : {}) }],
        });
      } catch (err) {
        return fail(msg.id, -32603, `Couldn't read ${res.uri}: ${(err as Error).message}`);
      }
    }
    case "tools/call": {
      const tool = tools.find((t) => t.name === p.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${String(p.name)}`);
      const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
      try {
        const out = await tool.run(args);
        if (out && typeof out === "object" && Array.isArray((out as RawContent).__mcpContent)) {
          return ok(msg.id, { content: (out as RawContent).__mcpContent });
        }
        if (out && typeof out === "object" && (out as PanelResult).__mcpPanel) {
          const { text, data } = (out as PanelResult).__mcpPanel;
          return ok(msg.id, { content: [{ type: "text", text }], structuredContent: data });
        }
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
      } catch (err) {
        // Tool errors go back to the model as results so it can adjust.
        return ok(msg.id, { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, …
      if (msg.method === "resources/templates/list") return ok(msg.id, { resourceTemplates: [] });
      if (msg.method === "prompts/list") return ok(msg.id, { prompts: [] });
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** One POST body → the reply body (null = 202 Accepted, nothing to say). */
export async function handleRpc(body: unknown, tools: ToolDef[], resources: ResourceDef[] = []): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as Rpc, tools, resources)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleOne(body as Rpc, tools, resources);
}

// ─── argument helpers for tools ──────────────────────────────────────────────

export function argStr(a: Record<string, unknown>, k: string, max = 200): string | null {
  const v = a[k];
  if (v == null || v === "") return null;
  return String(v).trim().slice(0, max) || null;
}

export function argNum(a: Record<string, unknown>, k: string, dflt: number | null, min: number, max: number): number | null {
  const v = a[k];
  if (v == null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
  return Math.min(max, Math.max(min, n));
}

export function argEnum<T extends string>(a: Record<string, unknown>, k: string, allowed: readonly T[], dflt: T): T {
  const v = a[k];
  if (v == null || v === "") return dflt;
  if (!allowed.includes(v as T)) throw new Error(`${k} must be one of: ${allowed.join(", ")}`);
  return v as T;
}

export function argDate(a: Record<string, unknown>, k: string): string | null {
  const v = argStr(a, k, 10);
  if (v == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k} must be YYYY-MM-DD`);
  return v;
}
