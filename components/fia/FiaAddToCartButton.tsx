"use client";

// Add-to-cart on a foundinalabama.com product page (Phase FIA-SHOP-1).
// The cart stores display values only; /api/fia/quote and checkout
// re-price everything server-side.

import { useState } from "react";
import { useCart } from "@/components/tes/CartProvider";
import type { ShipClass } from "@/lib/fia/shipping";

export default function FiaAddToCartButton({
  itemId,
  title,
  price,
  imageUrl,
  shipClass,
  maxQuantity,
}: {
  itemId: string;
  title: string;
  price: number;
  imageUrl: string | null;
  shipClass: ShipClass;
  maxQuantity: number;
}) {
  const { lines, add } = useCart();
  const [flash, setFlash] = useState(false);
  const inCart = lines.find((l) => l.itemId === itemId);
  const atMax = inCart != null && inCart.quantity >= maxQuantity;

  return (
    <button
      type="button"
      disabled={atMax}
      onClick={() => {
        add({ itemId, title, price, imageUrl, shipClass });
        setFlash(true);
        setTimeout(() => setFlash(false), 1200);
      }}
      className={`w-full text-base font-medium px-4 py-3 rounded-md transition-colors disabled:opacity-60 ${
        inCart
          ? "bg-brand-yellow/30 text-brand-ink hover:bg-brand-yellow/50"
          : "bg-brand-ink text-white hover:bg-brand-ink/85"
      }`}
    >
      {flash
        ? "Added ✓"
        : atMax
          ? "In your cart"
          : inCart
            ? "In cart — add another"
            : "Add to cart"}
    </button>
  );
}
