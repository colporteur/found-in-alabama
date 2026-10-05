"use client";

// FIA header cart link with live item count (Phase FIA-SHOP-1).

import Link from "next/link";
import { useCart } from "@/components/tes/CartProvider";

export default function FiaCartLink() {
  const { count, ready } = useCart();
  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-1.5 hover:underline underline-offset-4 decoration-brand-yellow decoration-2"
    >
      Cart
      {ready && count > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-brand-yellow text-brand-ink text-xs font-semibold">
          {count}
        </span>
      )}
    </Link>
  );
}
