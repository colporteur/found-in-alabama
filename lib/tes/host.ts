// Host-aware link prefix for The Ephemeral State pages.
//
// TES pages live at /tes/* in the app tree. On the real TES domain the
// middleware rewrite hides that prefix (theephemeralstate.com/shop/x →
// /tes/shop/x internally), so links should be written WITHOUT the /tes
// prefix there. When previewing the same pages on foundinalabama.com/tes
// (or localhost/tes) before DNS cutover, links need the explicit prefix.
// tesPrefix() returns the right one for the current request.

import { headers } from "next/headers";

export function isTesHostName(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0];
  return (
    h === "theephemeralstate.com" ||
    h === "www.theephemeralstate.com" ||
    h === "tes.localhost"
  );
}

/** "" on the TES domain (rewrite hides /tes), "/tes" everywhere else. */
export function tesPrefix(): string {
  const host = headers().get("host");
  return isTesHostName(host) ? "" : "/tes";
}

/** Home link for the current host ("/" on TES domain, "/tes" elsewhere). */
export function tesHome(): string {
  return tesPrefix() || "/";
}
