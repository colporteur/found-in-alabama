import type { Metadata } from "next";
import { marketplaces, socials, comingSoonSocials } from "@/lib/links";

export const metadata: Metadata = {
  title: "Find me",
  description:
    "All the places to follow Found in Alabama and shop the inventory — eBay, Etsy, Poshmark, Mercari, Depop, Whatnot, plus Instagram and Bluesky.",
};

export default function FindMePage() {
  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Find me
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-6">
          Find our <span className="marker-highlight">hauls.</span>
        </h1>
        <p className="text-lg text-brand-ink/80 max-w-prose leading-relaxed">
          Different finds end up in different places — vintage on Etsy,
          clothing on Poshmark and Depop, books and collectibles on eBay,
          live show pieces on Whatnot, and a bit of everything on Mercari.
          Here's where to look for what.
        </p>
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-14">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            Shop the inventory
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-8">
            Marketplaces
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {marketplaces.map((m) => (
              <a
                key={m.name}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group block border border-brand-ink/15 rounded-lg p-5 hover:border-brand-yellow hover:bg-brand-yellow/10 transition-colors"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-marker text-2xl">{m.name}</p>
                  <span className="text-xs text-brand-ink/60 group-hover:text-brand-ink transition-colors">
                    Visit →
                  </span>
                </div>
                {m.handle && (
                  <p className="text-sm font-medium text-brand-ink/70 mb-2">
                    {m.handle}
                  </p>
                )}
                {m.blurb && (
                  <p className="text-sm text-brand-ink/70 leading-relaxed">
                    {m.blurb}
                  </p>
                )}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="container-content py-14">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Follow along
        </p>
        <h2 className="font-marker text-3xl md:text-4xl mb-8">
          Social
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {socials.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block border border-brand-ink/15 rounded-lg p-5 hover:border-brand-yellow hover:bg-brand-yellow/10 transition-colors"
            >
              <div className="flex items-baseline justify-between mb-2">
                <p className="font-marker text-2xl">{s.name}</p>
                <span className="text-xs text-brand-ink/60 group-hover:text-brand-ink transition-colors">
                  Follow →
                </span>
              </div>
              {s.handle && (
                <p className="text-sm font-medium text-brand-ink/70">
                  {s.handle}
                </p>
              )}
            </a>
          ))}
        </div>

        {comingSoonSocials.length > 0 && (
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {comingSoonSocials.map((name) => (
              <div
                key={name}
                className="border border-dashed border-brand-ink/20 rounded-lg p-4 text-center"
              >
                <p className="font-marker text-xl text-brand-ink/40">{name}</p>
                <p className="text-xs text-brand-ink/50 mt-1">Coming soon</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
