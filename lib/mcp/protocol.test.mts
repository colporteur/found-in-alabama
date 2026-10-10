// Run: npx tsx --test lib/mcp/protocol.test.mts
import test from "node:test";
import assert from "node:assert/strict";
import { argDate, argEnum, argNum, handleRpc, type ToolDef } from "./protocol";

const tools: ToolDef[] = [
  { name: "echo", title: "Echo", description: "", inputSchema: { type: "object" }, run: async (a) => ({ got: a.x }) },
  { name: "boom", title: "Boom", description: "", inputSchema: { type: "object" }, run: async () => { throw new Error("nope"); } },
];

test("initialize negotiates the version", async () => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, tools)) as any;
  assert.equal(r.result.protocolVersion, "2025-03-26");
  assert.ok(r.result.capabilities.tools);
  const r2 = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, tools)) as any;
  assert.equal(r2.result.protocolVersion, "2025-06-18");
});

test("notifications get no reply", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, tools), null);
});

test("tools/list marks every tool read-only", async () => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, tools)) as any;
  assert.equal(r.result.tools.length, 2);
  assert.equal(r.result.tools[0].annotations.readOnlyHint, true);
});

test("tools/call returns text, errors become isError results", async () => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { x: 5 } } }, tools)) as any;
  assert.deepEqual(JSON.parse(r.result.content[0].text), { got: 5 });
  const e = (await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } }, tools)) as any;
  assert.equal(e.result.isError, true);
  const u = (await handleRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nah" } }, tools)) as any;
  assert.equal(u.error.code, -32602);
  const m = (await handleRpc({ jsonrpc: "2.0", id: 7, method: "weird/thing" }, tools)) as any;
  assert.equal(m.error.code, -32601);
});

test("arg helpers clamp and validate", () => {
  assert.equal(argNum({ n: 500 }, "n", 10, 1, 100), 100);
  assert.equal(argNum({}, "n", 10, 1, 100), 10);
  assert.throws(() => argNum({ n: "x" }, "n", 10, 1, 100));
  assert.equal(argEnum({ g: "venue" }, "g", ["venue", "month"] as const, "month"), "venue");
  assert.throws(() => argEnum({ g: "drop table" }, "g", ["venue"] as const, "venue"));
  assert.throws(() => argDate({ d: "10/1/2026" }, "d"));
});

test("raw content passes through and write tools aren't marked read-only", async () => {
  const { rawContent } = await import("./protocol");
  const t: ToolDef[] = [
    { name: "pics", title: "P", description: "", inputSchema: {}, readOnly: false, run: async () => rawContent([{ type: "image", data: "AA", mimeType: "image/jpeg" }]) },
  ];
  const l = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, t)) as any;
  assert.equal(l.result.tools[0].annotations.readOnlyHint, false);
  const r = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pics" } }, t)) as any;
  assert.equal(r.result.content[0].type, "image");
});
