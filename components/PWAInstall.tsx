"use client";

// Registers the service worker on mount and renders an "Install app" button
// when the browser flags the PWA as installable. iOS Safari doesn't fire
// beforeinstallprompt, so on iOS we show a one-line tip pointing to
// Share → Add to Home Screen instead of a button.

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function PWAInstall() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSTip, setShowIOSTip] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Register the service worker.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[pwa] SW registration failed:", err));
    }

    // Detect already-installed (running in standalone mode).
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari's flag for installed PWAs
      // @ts-expect-error - iOS-specific
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    // Detect iOS so we can show the manual instructions there.
    const ua = window.navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    setIsIOS(ios);

    // Capture the install prompt event so we can fire it on a button click.
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (installed) return null;

  // Android / desktop Chrome — show button when installable.
  if (installEvent) {
    return (
      <button
        type="button"
        onClick={async () => {
          await installEvent.prompt();
          const choice = await installEvent.userChoice;
          if (choice.outcome === "accepted") {
            setInstallEvent(null);
          }
        }}
        className="text-xs uppercase tracking-wider px-2.5 py-1 rounded bg-brand-yellow/30 text-brand-ink hover:bg-brand-yellow/50"
      >
        Install app
      </button>
    );
  }

  // iOS — no programmatic install, point to the Share menu.
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSTip((v) => !v)}
          className="text-xs uppercase tracking-wider px-2.5 py-1 rounded bg-brand-ink/10 text-brand-ink/70 hover:bg-brand-ink/20"
          aria-expanded={showIOSTip}
        >
          Install app
        </button>
        {showIOSTip && (
          <span className="text-xs text-brand-ink/70">
            Tap Share → Add to Home Screen
          </span>
        )}
      </>
    );
  }

  return null;
}
