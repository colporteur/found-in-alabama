// The Ephemeral State cart page. Client-rendered from the cart context;
// shipping computed with the shared schedule (same code the server will
// verify with at checkout). Checkout button is wired in phase 2b.

import type { Metadata } from "next";
import { tesHome } from "@/lib/tes/host";
import CartView from "./CartView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false },
};

export default function CartPage() {
  return <CartView home={tesHome()} />;
}
