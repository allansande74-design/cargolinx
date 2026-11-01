import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// A sub-path deploy (GitHub Pages serves this repo under /cargolinx/) needs every asset and
// manifest reference to carry the base, or the app loads a blank screen. Default stays root.
const BASE = process.env.VITE_BASE || "/";

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "icon-192.png", "icon-512.png"],
      manifest: {
        id: BASE,
        name: "CargoLinx — Altovex Global Logistics",
        short_name: "CargoLinx",
        description:
          "Order lifecycle, quotes, documents and clearance for Altovex Global Logistics. Works offline.",
        lang: "en",
        theme_color: "#071a33",
        background_color: "#071a33",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: BASE,
        scope: BASE,
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
        navigateFallback: BASE + "index.html",
        // the film page lives beside the app; without this the service worker answers a
        // navigation to /cargolinx/demo/ with the app shell and the video never appears
        navigateFallbackDenylist: [/\/demo\//],
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
