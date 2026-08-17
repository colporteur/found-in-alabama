"use client";

// Header cart link with live item count.

import Link from "next/link";
import { useCart } from "@/components/tes/CartProvider";

export default function CartLink({ href }: { href: string }) {
  const { count, ready } = useCart();
  return (
    <Link
      href={href}
      className="relative inline-flex items-center gap-1.5 hover:underline underline-offset-4 decoration-tes-kraft decoration-2"
    >
      Cart
      {ready && count > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-tes-kraft text-tes-ink text-xs font-semibold">
          {count}
        </span>
      )}
    </Link>
  );
}
