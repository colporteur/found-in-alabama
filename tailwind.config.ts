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
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        marker: ["var(--font-marker)", "Permanent Marker", "Comic Sans MS", "cursive"],
      },
      maxWidth: {
        prose: "65ch",
      },
    },
  },
  plugins: [],
};

export default config;
