import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "CargoLinx — Offline Freight Desk",
        short_name: "CargoLinx",
        description: "Landed cost, quoting, ETA and proof of delivery for East African corridors. Works offline.",
        theme_color: "#0b2545",
        background_color: "#0b2545",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes("supabase") || url.pathname.includes("/v1/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: { host: "0.0.0.0", port: 5173 },
});
