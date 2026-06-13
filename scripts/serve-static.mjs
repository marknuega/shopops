// Zero-dependency static file server for the built ShopOps app (dist/).
// Serves on PORT (default 4173) with SPA fallback to index.html.
// Used by the Windows startup task so the app is always available for the
// Tailscale Funnel / Cloudflare tunnel to expose.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { localMediaHandler } from "./local-media.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");
const PORT = process.env.PORT || 4173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (localMediaHandler(req, res)) return; // local video streaming for repair-log links
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    return send(res, 500, "Build missing. Run `npm run build` in the project root.");
  }
  // strip query, decode, prevent path traversal
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath.includes("..")) return send(res, 400, "Bad request");
  let filePath = path.join(DIST, urlPath);

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, "index.html");
    fs.readFile(filePath, (err2, data) => {
      if (err2) {
        // SPA fallback: serve index.html for unknown non-asset routes
        return fs.readFile(path.join(DIST, "index.html"), (e3, html) =>
          e3 ? send(res, 404, "Not found") : send(res, 200, html, { "Content-Type": TYPES[".html"] })
        );
      }
      const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      const cache = filePath.includes(`${path.sep}assets${path.sep}`)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      send(res, 200, data, { "Content-Type": type, "Cache-Control": cache });
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ShopOps static app serving dist/ on http://127.0.0.1:${PORT}`);
});
