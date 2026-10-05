import { readFileSync } from "node:fs";
import { hipConfig, type HipConnection } from "./client";

/** A local audit connection does not enable the existing sale/delist jobs. */
export function hipReadinessConnection(): HipConnection | null {
  const keyFile = process.env.HIP_READINESS_API_KEY_FILE;
  if (!keyFile) return hipConfig();
  const username = process.env.HIP_READINESS_USERNAME;
  if (!username) return null;
  try {
    const key = readFileSync(keyFile, "utf8").trim();
    if (!key || /\s/.test(key)) return null;
    return { base: "https://www.hippostcard.com/api", key, username };
  } catch {
    return null;
  }
}
