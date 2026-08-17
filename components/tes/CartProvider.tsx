"use client";

// The Ephemeral State cart — client-side React context persisted to
// localStorage. Prices/classes stored here are for DISPLAY; checkout
// (phase 2b) re-verifies every line against the mirror and live eBay
// server-side, so a tampered localStorage can't change what's charged.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ShipClass } from "@/lib/tes/shipping";

export type CartLine = {
  itemId: string;
  title: string;
  price: number;
  imageUrl: string | null;
  shipClass: ShipClass;
  quantity: number;
};

type CartContextValue = {
  lines: CartLine[];
  count: number;
  add: (line: Omit<CartLine, "quantity">) => void;
  remove: (itemId: string) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  clear: () => void;
  /** True once localStorage has been read (avoids hydration flicker). */
  ready: boolean;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "tes_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CartLine[];
        if (Array.isArray(parsed)) setLines(parsed.filter((l) => l?.itemId));
      }
    } catch {
      // corrupted cart — start fresh
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // storage full/blocked — cart still works in-memory
    }
  }, [lines, ready]);

  const add = useCallback((line: Omit<CartLine, "quantity">) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === line.itemId);
      if (existing) {
        return prev.map((l) =>
          l.itemId === line.itemId ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  }, []);

  const remove = useCallback((itemId: string) => {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }, []);

  const setQuantity = useCallback((itemId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.itemId !== itemId)
        : prev.map((l) => (l.itemId === itemId ? { ...l, quantity } : l))
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      add,
      remove,
      setQuantity,
      clear,
      ready,
    }),
    [lines, add, remove, setQuantity, clear, ready]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
