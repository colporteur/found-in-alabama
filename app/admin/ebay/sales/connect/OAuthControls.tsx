"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TestResult {
  ok: boolean;
  promotionsCount?: number;
  error?: string;
  status?: number;
  body?: string;
  durationMs?: number;
}

export default function OAuthControls({
  envVarsSet,
  connected,
}: {
  envVarsSet: boolean;
  connected: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch("/api/admin/ebay/sales/test-connection", {
        method: "POST",
      });
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        const text = await res.text();
        setTest({
          ok: false,
          error: `Server returned non-JSON (HTTP ${res.status})`,
          body: text.slice(0, 400),
        });
        return;
      }
      setTest((await res.json()) as TestResult);
    } catch (err) {
      setTest({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Sell API access? You'll need to re-authorize before creating any sales.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/admin/ebay/oauth/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="bg-white border border-brand-ink/15 rounded-lg p-5">
      <h2 className="font-medium text-lg mb-3">Actions</h2>
      <div className="flex flex-wrap gap-2 mb-4">
        <a
          href="/api/admin/ebay/oauth/start"
          className={`text-sm px-4 py-2 rounded ${
            envVarsSet
              ? "bg-brand-ink text-brand-paper hover:bg-brand-ink/90"
              : "bg-brand-ink/30 text-brand-paper cursor-not-allowed"
          }`}
          aria-disabled={!envVarsSet}
          onClick={(e) => {
            if (!envVarsSet) e.preventDefault();
          }}
        >
          {connected ? "Reconnect" : "Connect eBay account"}
        </a>
        <button
          type="button"
          disabled={!connected || testing}
          onClick={runTest}
          className="text-sm bg-brand-paper text-brand-ink border border-brand-ink/15 px-4 py-2 rounded hover:bg-brand-ink/5 disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        {connected && (
          <button
            type="button"
            disabled={disconnecting}
            onClick={disconnect}
            className="text-sm text-red-700 border border-red-200 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>

      {test && test.ok && (
        <div className="border-l-4 border-brand-yellow bg-brand-yellow/10 p-3 text-sm space-y-1">
          <p className="font-medium">✅ Sell API call succeeded.</p>
          <p>
            <span className="text-brand-ink/60">Active / scheduled promotions returned:</span>{" "}
            {test.promotionsCount ?? 0}
          </p>
          {test.durationMs != null && (
            <p className="text-xs text-brand-ink/50">{test.durationMs} ms</p>
          )}
        </div>
      )}
      {test && !test.ok && (
        <div className="border-l-4 border-red-500 bg-red-50 p-3 text-sm space-y-1 break-words">
          <p className="font-medium">Test failed</p>
          <p>{test.error}</p>
          {test.body && (
            <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-48">
              {test.body}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
