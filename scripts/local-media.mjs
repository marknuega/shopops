// Streams local video/media files to the browser for the ShopOps repair log.
// Pages served over http:// cannot open file:/// links (browsers block them),
// so "/local-media?p=<absolute path>" serves the file over HTTP instead —
// with Range support so videos seek properly in the native player.
//
// Security: only files inside LOCAL_MEDIA_ROOT are served (path-traversal safe).
// Default root covers C:\Users\DELL\Videos (incl. Screen Recordings); override
// with the LOCAL_MEDIA_DIR environment variable.
import fs from "fs";
import path from "path";

const LOCAL_MEDIA_ROOT = path.resolve(process.env.LOCAL_MEDIA_DIR || "C:/Users/DELL/Videos");

const MIME = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
  ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};

const insideRoot = (abs) => {
  const rel = path.relative(LOCAL_MEDIA_ROOT, abs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/* Connect-style handler. Returns true when the request was a /local-media
   request (handled here), false so the caller can continue its own routing. */
export function localMediaHandler(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/local-media") return false;

  const raw = (url.searchParams.get("p") || "").replace(/^"|"$/g, ""); // tolerate Explorer "Copy as path" quotes
  if (!raw) { res.writeHead(400, { "Content-Type": "text/plain" }); res.end("Missing ?p=<path>"); return true; }
  const abs = path.resolve(raw);
  if (!insideRoot(abs)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end(`Only files inside ${LOCAL_MEDIA_ROOT} can be played. Move the video there or set LOCAL_MEDIA_DIR.`);
    return true;
  }

  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("File not found: " + abs); return; }
    const type = MIME[path.extname(abs).toLowerCase()] || "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); res.end(); return;
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, {
        "Content-Type": type, "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1,
      });
      fs.createReadStream(abs, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": st.size });
      fs.createReadStream(abs).pipe(res);
    }
  });
  return true;
}
