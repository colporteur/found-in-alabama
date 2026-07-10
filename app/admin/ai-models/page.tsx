import AiModelsManager from "./AiModelsManager";

export const dynamic = "force-dynamic";

export default function AiModelsPage() {
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        AI Gateway
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">AI Models</h1>
      <p className="text-brand-ink/70 mb-4 max-w-prose">
        The routing table for your AI Gateway — every app (this site, the
        Nifty extension, and anything you build next) resolves its model
        here. Point an alias at a different model and the change is live on
        the next AI call. No deploys, no code edits.
      </p>

      <details className="mb-8 max-w-prose bg-white border border-brand-ink/15 rounded-lg">
        <summary className="cursor-pointer px-5 py-3 font-medium text-sm select-none">
          How this works (click to expand — read me when confused)
        </summary>
        <div className="px-5 pb-5 text-sm text-brand-ink/80 leading-relaxed [&_h3]:font-medium [&_h3]:text-brand-ink [&_h3]:mt-4 [&_h3]:mb-1 [&_code]:bg-brand-ink/5 [&_code]:px-1 [&_code]:rounded">
          <h3>The big picture</h3>
          <p>
            None of your apps talk to Anthropic, OpenAI, or Google directly
            anymore. They all call one Cloudflare Worker (the
            &ldquo;AI Gateway&rdquo;, named <code>ai-gateway</code> in your
            Cloudflare account), which holds your single OpenRouter key and
            forwards each request to whatever model this table says. This
            page edits that table — the data lives in Cloudflare KV, not in
            this site&rsquo;s code, which is why saving here changes model
            behavior everywhere instantly with no deploys.
          </p>

          <h3>What an alias is</h3>
          <p>
            A made-up name like <code>fia-drafts</code> that your apps
            request instead of a real model. This table translates it to a
            real OpenRouter model id (always <code>vendor/model</code>, like{" "}
            <code>anthropic/claude-sonnet-5</code>). To switch the model
            behind a feature: edit the alias&rsquo;s target, hit Save, done.
            An alias may also point at another alias (they chain).
          </p>

          <h3>How a request picks its model (resolution order)</h3>
          <p>
            1) If the request names a model/alias explicitly, that wins
            (this is how FiA&rsquo;s <code>fia-*</code> calls and the
            Enhance dropdowns work). 2) Otherwise the app&rsquo;s row under
            &ldquo;App defaults&rdquo; applies. 3) Otherwise the global
            default. Safety net: any name that doesn&rsquo;t resolve to a
            real <code>vendor/model</code> id falls back to the global
            default rather than erroring — so a typo&rsquo;d or missing
            alias degrades gracefully.
          </p>

          <h3>Who uses what</h3>
          <p>
            <code>fia-drafts</code>: haul drafts + newsletter.{" "}
            <code>fia-social</code>: social posts. <code>fia-cheap</code>:
            eBay categorizer, similar-items picker, voice-memo splitting.{" "}
            <code>pricing</code>: the Nifty extension&rsquo;s BIN pricing.
            Exceptions that do NOT go through the gateway: audio
            transcription (direct OpenAI — OpenRouter has no audio API) and
            the Enhance pipeline&rsquo;s per-batch model dropdowns (those
            pick explicit models in the UI, so this table only matters to
            them if a dropdown value ever fails to resolve).
          </p>

          <h3>Money</h3>
          <p>
            Prices shown are per <em>million</em> tokens (input / output).
            A typical text call uses a few thousand tokens; photo-heavy
            calls (pricing, drafts) use more. Every FiA call logs
            OpenRouter&rsquo;s actual billed cost to the AI call log, so
            the Enhance dashboard&rsquo;s spend numbers stay truthful no
            matter what you switch here. Billing is prepaid credits at
            openrouter.ai — that&rsquo;s also where you top up.
          </p>

          <h3>If something breaks</h3>
          <p>
            An &ldquo;unknown model id&rdquo; warning here means a target
            isn&rsquo;t in OpenRouter&rsquo;s current catalog (typo, or the
            model was retired) — pick a current one from the dropdown. If
            this page itself errors, check that{" "}
            <code>AI_GATEWAY_URL</code>, <code>AI_GATEWAY_TOKEN</code>, and{" "}
            <code>AI_GATEWAY_ADMIN_TOKEN</code> are set in Vercel. The same
            table can always be edited by hand at Cloudflare → Storage
            &amp; Databases → KV → CONFIG → key <code>routing</code>.
          </p>
        </div>
      </details>

      <AiModelsManager />
    </section>
  );
}
