import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/2k26-spinner/" : "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/")) return "vendor";
          if (normalized.endsWith("/src/data/players.json")) return "players-data";
          if (normalized.endsWith("/src/data/rosterCatalog.json")) return "roster-data";
          if (normalized.endsWith("/src/data/badgeProfiles.json")) return "badge-data";
          return undefined;
        },
      },
    },
  },
});
