"use client";

// Add-to-cart button on a TES item card. Shows brief "Added ✓" feedback
// and switches to an "in cart" state.

import { useState } from "react";
import { useCart } from "@/components/tes/CartProvider";
import type { ShipClass } from "@/lib/tes/shipping";

export default function AddToCartButton({
  itemId,
  title,
  price,
  imageUrl,
  shipClass,
}: {
  itemId: string;
  title: string;
  price: number | null;
  imageUrl: string | null;
  shipClass: ShipClass;
}) {
  const { lines, add } = useCart();
  const [flash, setFlash] = useState(false);
  const inCart = lines.some((l) => l.itemId === itemId);

  if (price == null) return null;

  return (
    <button
      type="button"
      onClick={() => {
        add({ itemId, title, price, imageUrl, shipClass });
        setFlash(true);
        setTimeout(() => setFlash(false), 1200);
      }}
      className={`w-full text-sm font-medium px-3 py-2 rounded-md transition-colors ${
        inCart
          ? "bg-tes-kraft/25 text-tes-ink hover:bg-tes-kraft/40"
          : "bg-tes-ink text-tes-cream hover:bg-tes-ink/85"
      }`}
    >
      {flash ? "Added ✓" : inCart ? "In cart — add another" : "Add to cart"}
    </button>
  );
}
