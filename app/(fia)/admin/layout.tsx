import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import PWAInstall from "@/components/PWAInstall";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  // Apple-specific PWA meta — gets the standalone home-screen experience
  // on iOS Safari.
  appleWebApp: {
    capable: true,
    title: "FiA Admin",
    statusBarStyle: "default",
  },
};

// Theme color for the mobile browser chrome / status bar.
export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
};

// Daily-use destinations only — everything else is one hop away via the
// grouped dashboard launcher.
const adminNav = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/draft", label: "Draft a haul" },
  { href: "/admin/ebay/workbench", label: "Workbench" },
  { href: "/admin/ebay/enhance", label: "Enhance" },
  { href: "/admin/social", label: "Social" },
  { href: "/admin/newsletter", label: "Newsletter" },
  { href: "/admin/inventory", label: "Inventory" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="bg-brand-paper min-h-screen">
      <div className="border-b border-brand-ink/10 bg-white">
        <div className="container-content py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="font-marker text-lg leading-none"
            >
              Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm flex-wrap">
              {adminNav.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-brand-ink/70 hover:text-brand-ink hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <PWAInstall />
            <span className="text-brand-ink/60 hidden sm:inline">
              {session.user.email}
            </span>
            <Link
              href="/"
              className="text-brand-ink/60 hover:text-brand-ink"
            >
              ← Back to site
            </Link>
            <form action={handleSignOut}>
              <button
                type="submit"
                className="text-brand-ink/60 hover:text-brand-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}
