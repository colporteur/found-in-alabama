// Root layout for The Ephemeral State (theephemeralstate.com).
// This is a second root layout — the (tes) route group has its own
// <html>/<body>, fonts, and metadata, fully independent of the FIA
// chrome. Requests reach these routes via the hostname rewrite in
// middleware.ts (or directly at /tes/* for previewing).

import type { Metadata } from "next";
import { Inter, Special_Elite } from "next/font/google";
import "../globals.css";
import TesHeader from "@/components/tes/TesHeader";
import TesFooter from "@/components/tes/TesFooter";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const typewriter = Special_Elite({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-typewriter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default:
      "The Ephemeral State — Antique paper Americana, state by state",
    template: "%s · The Ephemeral State",
  },
  description:
    "Postcards, photographs, documents, and other paper survivors from all fifty states. Curated American ephemera from the Found in Alabama family.",
  metadataBase: new URL("https://theephemeralstate.com"),
  openGraph: {
    title: "The Ephemeral State",
    description:
      "Antique paper Americana, state by state. Postcards, photos, documents, and other paper survivors.",
    url: "https://theephemeralstate.com",
    siteName: "The Ephemeral State",
    locale: "en_US",
    type: "website",
  },
};

export default function TesRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${typewriter.variable}`}>
      <body className="bg-tes-cream text-tes-ink font-sans antialiased min-h-screen flex flex-col">
        <TesHeader />
        <main className="flex-1">{children}</main>
        <TesFooter />
        <Analytics />
      </body>
    </html>
  );
}
