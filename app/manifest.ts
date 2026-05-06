// Web App Manifest. Next.js serves this at /manifest.webmanifest.
// "Add to Home Screen" on iOS / "Install app" on Android picks this up
// and treats /admin as a standalone application.
//
// To replace the icon, drop a 512x512 PNG named app-icon.png into the
// public/ folder and update the icons array below.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Found in Alabama Admin",
    short_name: "FiA Admin",
    description:
      "Inventory tools for Found in Alabama: recategorization, sales, and reporting.",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf6e8",
    theme_color: "#0f1115",
    icons: [
      // Using the existing logo.png for now. To get sharp icons on every
      // platform, replace with a 512x512 PNG and add the larger sizes here.
      {
        src: "/logo.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    categories: ["business", "productivity"],
  };
}
