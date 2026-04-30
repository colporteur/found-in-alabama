import { marketplaces, socials, comingSoonSocials, contact } from "@/lib/links";

export default function Footer() {
  return (
    <footer className="border-t border-brand-ink/10 bg-brand-ink text-brand-paper mt-16">
      <div className="container-content py-12">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-marker text-2xl leading-tight mb-3">
              Found in{" "}
              <span className="bg-brand-yellow text-brand-ink px-2 py-1 rounded inline-block">
                Alabama
              </span>
            </p>
            <p className="text-sm text-brand-paper/80 leading-relaxed mb-4">
              Estate finds, vintage, books, ephemera, and small antiques from
              central Alabama.
            </p>
            <p className="text-sm font-medium text-brand-paper/90">
              Pickups in & near Anniston, Birmingham, Huntsville, Auburn,
              Gadsden, and surrounding areas.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-brand-paper/50 mb-3">
              Shop the inventory
            </p>
            <ul className="space-y-2 text-sm">
              {marketplaces.map((m) => (
                <li key={m.name}>
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-brand-yellow transition-colors"
                  >
                    {m.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-brand-paper/50 mb-3">
              Follow along
            </p>
            <ul className="space-y-2 text-sm">
              {socials.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-brand-yellow transition-colors"
                  >
                    {s.name}
                  </a>
                </li>
              ))}
              {comingSoonSocials.map((name) => (
                <li key={name} className="text-brand-paper/40">
                  {name} · coming soon
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-brand-paper/20 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <a
            href={contact.smsHref}
            className="inline-flex items-center gap-2 text-brand-yellow font-medium hover:text-brand-yellow-light transition-colors"
          >
            Text us: {contact.phone} →
          </a>
          <p className="text-xs text-brand-paper/50">
            © {new Date().getFullYear()} Found in Alabama
          </p>
        </div>
      </div>
    </footer>
  );
}
