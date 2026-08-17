"use client";

// Empty the cart once payment has succeeded.

import { useEffect } from "react";
import { useCart } from "@/components/tes/CartProvider";

export default function ClearCart() {
  const { clear } = useCart();
  useEffect(() => {
    clear();
  }, [clear]);
  return null;
}
