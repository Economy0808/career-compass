import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "media",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        border: "var(--border)",
        muted: "var(--muted)",
        ink: {
          50: "#F7F7F5",
          100: "#EFEFEA",
          200: "#E1E0D9",
          300: "#C9C7BC",
          400: "#A3A092",
          500: "#7A776C",
          600: "#57544B",
          700: "#3D3B34",
          800: "#26241F",
          900: "#171613",
          950: "#0D0C0A",
        },
        accent: {
          50: "#F1F5EC",
          100: "#E1EAD8",
          200: "#C3D6B4",
          300: "#A0BE8B",
          400: "#7FA669",
          500: "#5F8A4C",
          600: "#4B6F3C",
          700: "#3B5730",
          800: "#2E4526",
          900: "#25381F",
        },
        overdue: {
          400: "#D08765",
          500: "#C15F3C",
          600: "#A34E30",
        },
        progress: {
          400: "#7C9CB8",
          500: "#5B7A99",
          600: "#48627E",
        },
      },
      borderRadius: {
        "3xl": "1.75rem",
        "4xl": "2.25rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(23, 22, 19, 0.04), 0 8px 24px rgba(23, 22, 19, 0.06)",
        softDark: "0 1px 2px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
