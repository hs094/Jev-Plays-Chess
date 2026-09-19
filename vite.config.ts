import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/jev": {
        target: "https://opencode.ai",
        changeOrigin: true,
        rewrite: () => "/zen/v1/systemone",
      },
    },
  },
});
