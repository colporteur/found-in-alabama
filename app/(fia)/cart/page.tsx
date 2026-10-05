// foundinalabama.com cart (Phase FIA-SHOP-1). Client-rendered from the
// cart context; prices and weight-based shipping come from /api/fia/quote,
// the same resolver checkout uses.

import type { Metadata } from "next";
import CartView from "./CartView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false },
};

export default function CartPage() {
  return <CartView />;
}
