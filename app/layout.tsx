import type { Metadata } from "next";
import { Inter, Permanent_Marker } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const marker = Permanent_Marker({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-marker",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Found in Alabama — Estate finds, vintage, books, and small antiques",
    template: "%s · Found in Alabama",
  },
  description:
    "Found in Alabama is a reseller of estate finds, vintage, books, ephemera, and small antiques. We buy estates and inventory across central Alabama.",
  metadataBase: new URL("https://foundinalabama.com"),
  openGraph: {
    title: "Found in Alabama",
    description:
      "Estate finds, vintage, books, and small antiques. We buy across Alabama.",
    url: "https://foundinalabama.com",
    siteName: "Found in Alabama",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${marker.variable}`}>
      <body className="bg-brand-paper text-brand-ink font-sans antialiased min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
