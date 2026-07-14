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
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Beanstalk greens: stem, leaves, ground
        bean: {
          950: "#050e07",
          900: "#06120a",
          850: "#081a0e",
          800: "#0e2013",
          750: "#132a18",
          700: "#173420",
          650: "#1c3a24",
          600: "#2c5b36",
          550: "#2a6134",
          500: "#3f8f47",
          400: "#5db35b",
          300: "#6abf63",
          200: "#8fdc8a",
          100: "#b9eab2",
        },
        // Text tones on dark forest background
        moss: {
          50: "#f2f7ee",
          100: "#eaf5e6",
          300: "#c8ecc2",
          400: "#a9c3aa",
          500: "#8aa78d",
          600: "#7fae83",
          700: "#6f8f74",
        },
        // Night-sky accents near the goal
        night: {
          300: "#9db8c9",
          700: "#152a3d",
          800: "#233a52",
        },
        // Blossom / celebration golds
        bloom: {
          100: "#f5f7ea",
          200: "#efe8bd",
          300: "#f0e8b4",
          500: "#e2b94f",
        },
        // Overdue "needs watering" browns
        wither: {
          300: "#d8b078",
          500: "#8a6a3a",
          600: "#7a5c33",
          700: "#6e5430",
          800: "#5a4527",
        },
      },
      fontFamily: {
        sans: ["var(--font-plex)", "sans-serif"],
        serif: ["var(--font-gowun)", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
