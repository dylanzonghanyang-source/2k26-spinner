import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#fafaf8",
          100: "#f2f2ee",
          200: "#e5e5df",
          300: "#d1d1c9",
          400: "#a3a39b",
          500: "#76766f",
          600: "#575752",
          700: "#40403c",
          800: "#2e2e2b",
          900: "#20201d"
        },
        court: {
          50: "#eef8f3",
          100: "#dcefe5",
          200: "#b9decc",
          300: "#83c4a8",
          400: "#4ba781",
          500: "#26785f",
          600: "#216f57",
          700: "#1d5949",
          800: "#19483c",
          900: "#153b32"
        },
        warning: {
          50: "#fbf6eb",
          100: "#f5e9d0",
          200: "#ead09f",
          300: "#d4ad68",
          400: "#bc883b",
          500: "#9a6424",
          600: "#80501d",
          700: "#673e19",
          800: "#543318",
          900: "#472b17"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(32,32,29,0.08), 0 12px 28px rgba(32,32,29,0.12)"
      }
    }
  },
  plugins: []
} satisfies Config;
