import type { Metadata } from "next";
import { contact } from "@/lib/links";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Text or call 256-684-1253 to reach Found in Alabama. Estate inquiries, picker appointments, and inventory buyout offers welcome.",
};

export default function ContactPage() {
  return (
    <>
      <section className="container-content py-16">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Contact
        </p>
        <h1 className="font-marker text-4xl md:text-6xl leading-tight mb-8">
          The fastest way
          <br />
          to <span className="marker-highlight">reach us.</span>
        </h1>

        <div className="grid gap-6 md:grid-cols-2 max-w-3xl">
          <a
            href={contact.smsHref}
            className="block border-2 border-brand-ink rounded-lg p-6 hover:bg-brand-yellow hover:border-brand-yellow transition-colors"
          >
            <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
              Text — preferred
            </p>
            <p className="font-marker text-3xl mb-2">{contact.phone}</p>
            <p className="text-sm text-brand-ink/80">
              Photos and a rough description go a long way. We typically reply
              within a few hours during the day.
            </p>
          </a>

          <a
            href={`tel:${contact.phoneTel}`}
            className="block border-2 border-brand-ink/15 rounded-lg p-6 hover:border-brand-ink transition-colors"
          >
            <p className="text-xs uppercase tracking-wider text-brand-earth mb-2">
              Call
            </p>
            <p className="font-marker text-3xl mb-2">{contact.phone}</p>
            <p className="text-sm text-brand-ink/80">
              If we miss you, leave a voicemail. We'll get back to you the same
              day if it isn't already evening.
            </p>
          </a>
        </div>
      </section>

      <section className="bg-white border-y border-brand-ink/10">
        <div className="container-content py-14">
          <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
            What to expect
          </p>
          <h2 className="font-marker text-3xl md:text-4xl mb-6">
            How we handle inquiries.
          </h2>
          <ul className="space-y-4 max-w-prose text-brand-ink/85">
            <li className="flex gap-4">
              <span className="font-marker text-2xl text-brand-yellow-dark shrink-0">
                ·
              </span>
              <span>
                <span className="font-medium">Estate &amp; collection buyouts:</span>{" "}
                send photos, your general location, and any timing constraints.
                We'll respond with next steps the same day.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="font-marker text-2xl text-brand-yellow-dark shrink-0">
                ·
              </span>
              <span>
                <span className="font-medium">Picker appointments:</span> if
                you have a barn, basement, or storage unit you want us to walk
                through, we'll set a time.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="font-marker text-2xl text-brand-yellow-dark shrink-0">
                ·
              </span>
              <span>
                <span className="font-medium">Sales &amp; shipping questions:</span>{" "}
                if you bought something from us on a marketplace, the fastest
                way is through that platform's messaging — but text works too.
              </span>
            </li>
            <li className="flex gap-4">
              <span className="font-marker text-2xl text-brand-yellow-dark shrink-0">
                ·
              </span>
              <span>
                <span className="font-medium">Just curious:</span> we don't
                mind. Ask about an item, a category, or whether it's worth the
                drive to bring something by.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="container-content py-14">
        <p className="text-xs uppercase tracking-wider text-brand-earth mb-3">
          Where we work
        </p>
        <h2 className="font-marker text-3xl md:text-4xl mb-6">
          Pickups across central Alabama.
        </h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 max-w-3xl">
          {contact.serviceArea.map((city) => (
            <li
              key={city}
              className="font-medium border-l-2 border-brand-yellow pl-3 py-1"
            >
              {city}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
