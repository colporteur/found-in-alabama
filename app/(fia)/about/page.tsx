import type { Metadata } from "next";
import Link from "next/link";
import { contact } from "@/lib/links";

export const metadata: Metadata = {
  title: "About",
  description:
    "Found in Alabama is a small, family-run reseller operating out of central Alabama. We rescue good things from estates, libraries, and auctions and find them new homes across six marketplaces.",
};

// NOTE FOR TODD: this is placeholder copy meant to capture the spirit
// of what you've described. Rewrite anything that doesn't sound like you.
// Look especially at the "colporteur" reference — it ties in nicely with
// your handles and the books focus, but only keep it if it resonates.

export default function AboutPage() {
  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          About
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-8">
          A small Alabama operation
          <br />
          with a <span className="marker-highlight">long memory.</span>
        </h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/photos/workspace.jpg"
          alt="Inside the Found in Alabama packing operation — shelves of corrugated mailers, packing supplies, and a print station."
          className="w-full rounded-lg mb-10 max-h-[480px] object-cover"
        />
        <div className="prose prose-lg max-w-prose text-brand-ink/85 leading-relaxed space-y-5">
          <p>
            Found in Alabama is a small, owner-run reseller working out of
            central Alabama. We buy estates, libraries, and collections — and
            sometimes a single good box at a yard sale — and we find new homes
            for what's inside.
          </p>
          <p>
            We come from the colporteur tradition: the old practice of carrying
            books from town to town, looking for the right reader. The work
            doesn't look quite the same in 2026, but the spirit is similar. A
            book sitting on a shelf in a basement isn't doing anyone much good.
            A box of postcards no one in the family wants will end up in the
            landfill. Most of what we buy would otherwise. Our job is to get it
            in front of the person who actually wants it.
          </p>
          <p>
            Books are still our heart, but the business has grown to cover most
            of what comes out of an Alabama estate: vintage clothing, paper
            ephemera, advertising, small antiques, militaria, religious items,
            railroadiana, sports memorabilia, and the long tail of whatever
            else seems to have value to someone, somewhere.
          </p>
          <p>
            Every item we list is researched, priced, photographed, and put in
            front of buyers across six marketplaces — eBay, Etsy, Poshmark,
            Mercari, Depop, and Whatnot. We currently keep more than five
            thousand items active, with new listings going up daily.
          </p>
          <p>
            If you have an estate to clear out, a collection you're ready to
            part with, or a basement of inventory you'd rather not deal with,
            we'd like to hear from you.{" "}
            <Link
              href="/we-buy"
              className="underline decoration-brand-yellow decoration-2 underline-offset-4"
            >
              Here's how that works
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-marker text-2xl md:text-3xl mb-2">
              Want to talk?
            </h2>
            <p className="text-brand-ink/80">
              Text is fastest. We answer most messages the same day.
            </p>
          </div>
          <a href={contact.smsHref} className="btn-primary">
            Text {contact.phone} →
          </a>
        </div>
      </section>
    </>
  );
}
