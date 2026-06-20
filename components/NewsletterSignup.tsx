"use client";

// Email signup form. Renders inline (intended for the Footer). After
// submit, swaps to a "check your email" message until the user reloads.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewsletterSignup({
  source = "footer",
}: {
  source?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSubmitted(true);
      // Bounce to the check-email page for a fuller explanation
      router.push("/newsletter/check-email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <p className="text-sm text-brand-paper/90">
        Check your inbox for a confirmation link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="newsletter-email" className="sr-only">
        Email address
      </label>
      <div className="flex gap-2">
        <input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md bg-brand-paper text-brand-ink placeholder:text-brand-ink/40 border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-yellow"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-md bg-brand-yellow text-brand-ink hover:bg-brand-yellow-dark transition-colors disabled:opacity-50"
        >
          {busy ? "…" : "Subscribe"}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
