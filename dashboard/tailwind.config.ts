import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0F172A",
        "navy-deep": "#0A2540",
        mint: "#14B8A6",
        "mint-bright": "#00D4AA",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(to right, #14B8A6 1px, transparent 1px), linear-gradient(to bottom, #14B8A6 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
