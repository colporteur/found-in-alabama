import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata = {
  robots: { index: false, follow: false },
};

const adminNav = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/draft", label: "Draft a haul" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/api-keys", label: "API keys" },
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
            <nav className="flex items-center gap-4 text-sm">
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
