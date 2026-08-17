import type { Metadata } from "next";
import { contact } from "@/lib/links";

export const metadata: Metadata = {
  title: "We buy estates and collections",
  description:
    "We pay cash for estates, libraries, collections, and inventory buyouts across central Alabama. Books, ephemera, vintage, small antiques, and a long list besides.",
};

const categories = [
  "Books",
  "DVDs / CDs / Vinyl",
  "Video Games",
  "Collectibles",
  "Paper / Ephemera",
  "Vintage Photos",
  "Electronics",
  "Sports Equipment",
  "Matchbooks",
  "Pins / Pinbacks",
  "Political Items",
  "Military Items",
  "Magazines",
  "Postcards",
  "Vintage Toys",
  "Sheet Music",
  "Trading Cards",
  "Railroad Items",
  "Barware",
  "NOS Items",
  "Scout Items",
  "Fraternal Items",
  "Alabama Items",
  "Auburn Items",
  "Bottles",
  "Patches",
  "Alabama Interest",
  "Maps",
  "Vintage Ads",
  "Jewelry",
  "Religious Items",
  "Artwork",
  "Comics",
  "License Plates",
  "Small Antiques",
];

export default function WeBuyPage() {
  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          We buy
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-6">
          Get cash for the things
          <br />
          <span className="marker-highlight">tucked in your attic.</span>
        </h1>
        <p className="text-lg text-brand-ink/80 max-w-prose leading-relaxed">
          Estates, libraries, collections, downsizes, inventory buyouts — if you
          have a quantity of the kind of things listed below, we'd like to take
          a look. Text photos and a rough description and we'll get back to you
          fast.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={contact.smsHref} className="btn-primary">
            Text {contact.phone} →
          </a>
          <a
            href={`tel:${contact.phoneTel}`}
            className="btn-secondary"
          >
            Or call
          </a>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/photos/estate-haul.jpg"
          alt="Boxes and items from a recent estate haul — books, ephemera, and small antiques staged for processing."
          className="w-full rounded-lg mt-10 max-h-[500px] object-cover"
        />
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-16">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            What we look for
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-2">
            Get cash for:
          </h2>
          <p className="text-brand-ink/70 mb-8">
            And much more. If you're not sure, ask.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-2">
            {categories.map((cat) => (
              <p
                key={cat}
                className="text-sm md:text-base font-medium border-l-2 border-brand-yellow pl-3 py-1"
              >
                {cat}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          How it works
        </p>
        <h2 className="font-marker text-3xl md:text-4xl mb-12">
          Three steps, no pressure.
        </h2>
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="font-marker text-3xl text-brand-yellow-dark mb-3">01</p>
            <h3 className="font-medium text-lg mb-2">Text us photos</h3>
            <p className="text-brand-ink/80 text-sm leading-relaxed">
              Send a few snapshots of what you have to{" "}
              <a
                href={contact.smsHref}
                className="underline decoration-brand-yellow decoration-2 underline-offset-4"
              >
                {contact.phone}
              </a>{" "}
              along with rough quantity and your general location.
            </p>
          </div>
          <div>
            <p className="font-marker text-3xl text-brand-yellow-dark mb-3">02</p>
            <h3 className="font-medium text-lg mb-2">We come look</h3>
            <p className="text-brand-ink/80 text-sm leading-relaxed">
              For larger lots, we drive out to you. We work fast and respect
              the home — many of our buys are time-sensitive estates.
            </p>
          </div>
          <div>
            <p className="font-marker text-3xl text-brand-yellow-dark mb-3">03</p>
            <h3 className="font-medium text-lg mb-2">Cash on the spot</h3>
            <p className="text-brand-ink/80 text-sm leading-relaxed">
              Fair offers, paid up front, and we haul it out. No commission
              splits, no waiting on auction sales.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-16">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            Service area
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-8">
            Pickups in &amp; near:
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {contact.serviceArea.map((city) => (
              <li key={city} className="font-medium border-l-2 border-brand-yellow pl-3 py-1">
                {city}
              </li>
            ))}
          </ul>
          <p className="text-sm text-brand-ink/70 mt-8 max-w-prose leading-relaxed">
            Outside this list? Text us anyway. For sizable lots we travel
            further, and we sometimes coordinate routes when buying near other
            stops.
          </p>
        </div>
      </section>

      <section className="bg-brand-yellow">
        <div className="container-content py-14 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="font-marker text-3xl md:text-4xl mb-2">
              Ready when you are.
            </h2>
            <p className="text-brand-ink/80">
              No obligation. Text first — it's the fastest way to reach us.
            </p>
          </div>
          <a
            href={contact.smsHref}
            className="inline-flex items-center justify-center px-7 py-4 bg-brand-ink text-brand-paper font-medium rounded-md hover:bg-brand-ink/90 transition-colors text-lg"
          >
            Text {contact.phone} →
          </a>
        </div>
      </section>
    </>
  );
}
