import Link from "next/link";

const navLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/we-buy", label: "We buy" },
  { href: "/journal", label: "Journal" },
  { href: "/about", label: "About" },
  { href: "/find-me", label: "Find me" },
  { href: "/contact", label: "Contact" },
];

export default function Header() {
  return (
    <header className="border-b border-brand-ink/10 bg-brand-paper">
      <div className="container-content py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link href="/" className="inline-flex items-center gap-3 group">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Found in Alabama"
            className="h-24 w-auto sm:h-28"
          />
          <span className="sr-only">Found in Alabama</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
