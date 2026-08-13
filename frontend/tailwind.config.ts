import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Surface: altitude-based backgrounds ---
        sky: { base: "#0B1E3D", mid: "#0E2438" },
        earth: { base: "#06120A", mid: "#0D2119" },
        surface: {
          raised: "rgba(10,28,42,.55)",
          overlay: "rgba(6,16,12,.86)",
        },
        // --- Content: text ramp that works on both navy and forest ---
        content: {
          primary: "#EAF3EE",
          secondary: "#9FB6AD",
          muted: "#7D968C",
        },
        // --- Accent: colours that carry meaning ---
        // growth = where the user is now; goal = where they are heading
        growth: { DEFAULT: "#5DB35B", bright: "#8FDC8A", dim: "#2C5B36" },
        goal: { DEFAULT: "#2F6FBF", bright: "#7CC4F0", dim: "#173A5E" },
        bloom: { DEFAULT: "#E2B94F", bright: "#EFE8BD" },
        wither: { DEFAULT: "#D8B078", dim: "#5A4527" },
        // --- Line: replaces 91 hand-written rgba borders ---
        line: {
          DEFAULT: "rgba(140,180,220,.17)",
          strong: "rgba(140,180,220,.34)",
        },
      },
      fontSize: {
        display: ["1.875rem", { lineHeight: "1.3" }],      // 30px
        title: ["1.25rem", { lineHeight: "1.35" }],        // 20px
        heading: ["1.0625rem", { lineHeight: "1.4" }],     // 17px
        body: ["0.9375rem", { lineHeight: "1.65" }],       // 15px
        "body-sm": ["0.84375rem", { lineHeight: "1.6" }],  // 13.5px
        caption: ["0.75rem", { lineHeight: "1.5" }],       // 12px
        micro: ["0.65625rem", { lineHeight: "1.45" }],     // 10.5px
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "20px" },
      // Shadow tokens. A box-shadow colour cannot come from a colour token,
      // so the few shadows the design uses live here instead of raw rgba()
      // scattered across call sites.
      boxShadow: {
        glow: "0 0 34px rgb(63 143 71 / .28)",
        "glow-strong": "0 0 44px rgb(63 143 71 / .45)",
        "glow-bloom": "0 0 44px rgb(226 185 79 / .4)",
        fab: "0 5px 18px rgb(47 111 191 / .45)",
        panel: "0 8px 26px rgb(0 0 0 / .38)",
        overlay: "0 14px 40px rgb(0 0 0 / .55)",
      },
      backgroundImage: {
        altitude:
          "linear-gradient(180deg,#0B1E3D 0%,#0E2438 30%,#0D2119 68%,#06120A 100%)",
      },
      spacing: {
        tabbar: "58px",
        rail: "196px",
      },
      // Tailwind 3.4's default opacity scale only covers multiples of 5
      // (/15, /25, ...). These extra steps are needed by /12, /18, etc.
      // opacity utilities used by the upcoming UI primitives; without
      // them those classes silently emit no CSS.
      opacity: { 6: ".06", 8: ".08", 12: ".12", 13: ".13", 18: ".18", 22: ".22" },
      fontFamily: {
        sans: ["var(--font-plex)", "sans-serif"],
        serif: ["var(--font-gowun)", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
