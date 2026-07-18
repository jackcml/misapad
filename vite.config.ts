import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: false,
  },
  // Escape hatch for providers that block browser origins: uncomment, set
  // target to your provider, and use base URL "/api/v1" in misapad settings.
  // server: {
  //   proxy: {
  //     "/api": {
  //       target: "https://api.example.com",
  //       changeOrigin: true,
  //       rewrite: (path) => path.replace(/^\/api/, ""),
  //     },
  //   },
  // },
});
