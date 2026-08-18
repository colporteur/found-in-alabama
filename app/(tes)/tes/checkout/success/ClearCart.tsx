"use client";

// Empty the cart once payment has succeeded.
//
// NOTE the `ready` guard: child effects run before parent effects in
// React, so an unguarded clear() fires BEFORE CartProvider loads the
// saved cart from localStorage — which would then restore the "cleared"
// items right back. Waiting for ready means we clear after the load.

import { useEffect } from "react";
import { useCart } from "@/components/tes/CartProvider";

export default function ClearCart() {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready) clear();
  }, [ready, clear]);
  return null;
}
