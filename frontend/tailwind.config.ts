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
        // --- OurLab token system (constellation graph, dark-only) ---
        // Ground was originally a deliberately-light ink blue (see prior
        // comment: "not near-black, avoiding the default AI look"), but
        // user feedback called it "too light and too blue" and asked for
        // pitch-black deep space. 900 now sits near-black, hue-matched to
        // the old value so it still reads as "ink" rather than flat #000
        // (see globals.css --ink-900 for the full rationale). Must match
        // globals.css's --ink-900 exactly — this utility does not read the
        // CSS variable, it's a separate hardcoded value.
        ink: { 900: "#04060B", 800: "#131829", 700: "#1C2338" },
        rule: "#2A3350", // hairlines, chart grid — use rule/NN for opacity steps
        text: { hi: "#E8EAF2", lo: "#8891AC" },
        // Stellar spectral classes double as element-type accents.
        spec: {
          b: "#9DB4FF", // course        (수업)
          a: "#E8ECFF", // certification (자격증)
          g: "#FFD98A", // organization  (학회)
          k: "#FFA76B", // activity      (대외활동)
          m: "#FF7B72", // networking    (네트워킹)
        },
        lit: "#FFF3C4", // warm starlight — a "lit" edge (never green)
        // Paper star-chart palette (bright landing surface only). Duplicated
        // as CSS variables in globals.css --paper-* — keep both in sync.
        paper: {
          DEFAULT: "#F6F7FA",
          line: "#C9CEE0",
          soft: "#E3E6F0",
          ink: "#10141F",
          lo: "#5C6480",
          faint: "#AFB6CC",
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
        // Beansprout-era green glow tokens removed 2026-08-27 — the lit edge
        // is never green (see DESIGN.md); warm gold bloom is the only glow.
        "glow-bloom": "0 0 44px rgb(226 185 79 / .4)",
        fab: "0 5px 18px rgb(47 111 191 / .45)",
        panel: "0 8px 26px rgb(0 0 0 / .38)",
        overlay: "0 14px 40px rgb(0 0 0 / .55)",
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
        // Body/UI: handles Korean + Latin with more character than Inter.
        sans: ["var(--font-plex)", "sans-serif"],
        // Display: 별자리 이름과 페이지 제목 전용. UI chrome에는 쓰지 않는다.
        serif: ["var(--font-gowun)", "serif"],
        // Data: 학정번호(예: BIZ2101)와 학점 숫자 전용.
        mono: ["var(--font-plex-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
