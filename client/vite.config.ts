import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Avoid SW caching issues during `vite dev` (blank page / missing hashed assets).
      devOptions: { enabled: false },
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Predict Chess",
        short_name: "Predict Chess",
        description: "Scacchi con mosse programmate e risoluzione simultanea",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/health": "http://127.0.0.1:2567",
      "/match": "http://127.0.0.1:2567",
      "/bot": "http://127.0.0.1:2567",
    },
  },
});
