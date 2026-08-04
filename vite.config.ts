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
          if (/\/src\/data\/badgeProfiles\.2k\d+\.json$/.test(normalized)) return "badge-data";
          if (normalized.includes("/src/data/versions/2k26/players.json")) return "players-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/players.json")) return "players-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/rosterCatalog.json")) return "roster-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/rosterCatalog.json")) return "roster-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/badges.json")) return "badges-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/badges.json")) return "badges-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/rookieOverallModel.json")) return "ovr-2k26-model";
          if (normalized.includes("/src/data/versions/2k27-play-now/rookieOverallModel.json")) return "ovr-2k27-model";
          return undefined;
        },
      },
    },
  },
});
