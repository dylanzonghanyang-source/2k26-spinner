import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#fbfefd",
          100: "#eef6f4",
          200: "#d7e7e4",
          300: "#b6ceca",
          400: "#86a9a7",
          500: "#5f8585",
          600: "#436a6c",
          700: "#2f5155",
          800: "#223b40",
          900: "#172b30"
        },
        court: {
          50: "#eefbf8",
          100: "#d5f4ed",
          200: "#aee8dc",
          300: "#74d4c4",
          400: "#39b9a8",
          500: "#219b8e",
          600: "#187d74",
          700: "#17645f",
          800: "#164f4d",
          900: "#123f3e"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(38,96,112,0.12), 0 22px 52px rgba(31,73,86,0.15)"
      }
    }
  },
  plugins: []
} satisfies Config;
