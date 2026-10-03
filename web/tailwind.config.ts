import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Class strings kept in lib (for example lib/strike/noticeStyles.ts) must be scanned too,
    // or utilities that appear only there are never generated.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0B1829",
        "blue-brand": "#2E7CB8",
        "blue-mid": "#5090C0",
        gold: "#C9A227",
        night: "#0D1B2A",
        "off-white": "#F7F6F3",
        border: "#E2E0DA",
        "text-primary": "#1A1A2E",
        "text-secondary": "#4A5568",
        "text-muted": "#8098B4",
        "green-brand": "#0F6E56",
        "green-lt": "#E1F5EE",
        "amber-brand": "#BA7517",
        "amber-lt": "#FAEEDA",
        "red-brand": "#A32D2D",
        "red-lt": "#FCEBEB",
        "purple-brand": "#534AB7",
        "purple-lt": "#EEEDFE",
        "gray-lt": "#F2F2F0",
        "code-bg": "#F0F4F8",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "beacon-pop": "beacon-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "count-up": "count-up 0.6s ease-out forwards",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { opacity: "0.4", transform: "scale(1)" },
          "50%": { opacity: "0.15", transform: "scale(1.08)" },
        },
        "beacon-pop": {
          "0%": { opacity: "0", transform: "scale(0.5)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
