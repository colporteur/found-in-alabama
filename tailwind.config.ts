import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette pulled from the business card
        brand: {
          yellow: "#FCC419",        // the school-bus yellow of the AL silhouette
          "yellow-dark": "#E5A800",
          "yellow-light": "#FFE584",
          ink: "#1A1A1A",           // soft-black headlines/body
          paper: "#FAF7F0",         // warm off-white page background
          earth: "#8B6F47",         // muted brown accent
        },
        // The Ephemeral State palette — pulled from the postmark logo:
        // aged kraft paper, warm cream, dark brown ink, cancel-stamp grey.
        tes: {
          kraft: "#D9A25F",         // aged kraft/amber of the map
          "kraft-dark": "#B9834A",  // deeper amber for hovers
          cream: "#F7F1E4",         // warm paper background
          ink: "#332A1F",           // dark brown headlines/body
          stamp: "#5C5346",         // postmark-ink grey-brown accent
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        marker: ["var(--font-marker)", "Permanent Marker", "Comic Sans MS", "cursive"],
        typewriter: ["var(--font-typewriter)", "Special Elite", "Courier New", "monospace"],
      },
      maxWidth: {
        prose: "65ch",
      },
    },
  },
  plugins: [],
};

export default config;
