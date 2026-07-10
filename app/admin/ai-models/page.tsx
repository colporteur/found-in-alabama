import AiModelsManager from "./AiModelsManager";

export const dynamic = "force-dynamic";

export default function AiModelsPage() {
  return (
    <section className="container-content py-12">
      <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
        AI Gateway
      </p>
      <h1 className="font-marker text-3xl md:text-4xl mb-3">AI Models</h1>
      <p className="text-brand-ink/70 mb-8 max-w-prose">
        The routing table for your AI Gateway — every app (this site, the
        Nifty extension, and anything you build next) resolves its model
        here. Point an alias at a different model and the change is live on
        the next AI call. No deploys, no code edits.
      </p>
      <AiModelsManager />
    </section>
  );
}
