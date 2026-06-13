import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localMediaHandler } from "./scripts/local-media.mjs";

// Streams local videos (repair-log video links) from the Videos folder over
// HTTP — file:/// links are blocked by browsers. Active in dev AND preview.
const localMedia = () => {
  // NOTE: no implicit return — Vite calls a returned function as a post hook.
  const use = (server) => { server.middlewares.use((req, res, next) => { if (!localMediaHandler(req, res)) next(); }); };
  return { name: "shopops-local-media", configureServer: use, configurePreviewServer: use };
};

export default defineConfig({
  plugins: [react(), localMedia()],
  server: {
    open: true,
    proxy: {
      // forward API calls to the Express server during development
      "/api": "http://localhost:4000",
    },
  },
  // `npm run preview` serves the production build; allow any host so it can be
  // exposed through a Cloudflare quick tunnel for mobile/WAN access.
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
