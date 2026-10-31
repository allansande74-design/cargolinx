import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        id: "/",
        name: "CargoLinx — Altovex Global Logistics",
        short_name: "CargoLinx",
        description:
          "Order lifecycle, quotes, documents and clearance for Altovex Global Logistics. Works offline.",
        lang: "en",
        theme_color: "#071a33",
        background_color: "#071a33",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        categories: ["business", "productivity"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
          { src: "/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "New quote", short_name: "Quote", url: "/?view=quote" },
          { name: "My orders", short_name: "Orders", url: "/?view=orders" },
          { name: "Ask Amanda", short_name: "Amanda", url: "/?view=amanda" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,woff2,webmanifest}"],
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
