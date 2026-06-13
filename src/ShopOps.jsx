import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, ShoppingCart, Package, Wrench, Receipt, Lock,
  TrendingUp, Star, Users, AlertTriangle, Plus, X, Check,
  Trash2, ChevronRight, Clock, Banknote, ClipboardList, ArrowLeftRight,
  ListTodo, FileSpreadsheet, LogOut, Download, RefreshCw,
  ArrowRightLeft, UserRound, Search, Pencil, Printer, RotateCcw, BarChart3, ScanLine,
  Image as ImageIcon, Sun, Moon, FileText, Paperclip, Video,
} from "lucide-react";
import { api, downloadReport, setActiveBranch, getActiveBranch, resetDemo } from "./api.js";
import { MOCK } from "./config.js";
import { useAuth } from "./auth.jsx";
import { printReceipt, printClaim } from "./print.js";

/* ============================================================
   ShopOps — Remote Manager (API edition)
   ============================================================ */
// Palette mapped to CSS variables (see src/index.css) so a single
// data-theme="dark" toggle repaints the whole UI. `brand`/`brandSoft` stay
// dark teal in both themes (header, nav, primary buttons).
const C = {
  ink: "var(--c-ink)", inkSoft: "var(--c-ink-soft)", amber: "var(--c-amber)", amberSoft: "var(--c-amber-soft)",
  amberText: "var(--c-amber-text)", brand: "var(--c-brand)", brandSoft: "var(--c-brand-soft)",
  bg: "var(--c-bg)", surface: "var(--c-surface)", line: "var(--c-line)", muted: "var(--c-muted)",
  green: "var(--c-green)", greenSoft: "var(--c-green-soft)", red: "var(--c-red)", redSoft: "var(--c-red-soft)",
  input: "var(--c-input)", subtle: "var(--c-subtle)", track: "var(--c-track)",
};

const peso = (n) =>
  "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const phNow = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
const phDate = (ts) => (ts ? new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) : "");
const fmtDT = (ts) =>
  ts ? new Date(ts).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

// Human labels for the five access levels. Permissions are enforced on the
// server (see server/src/auth.js); these are just for display.
const ROLE_LABELS = {
  owner: "Owner", manager: "Manager", sales: "Sales", technician: "Technician", partner: "Business partner",
};

const PAYMENTS = [["cash", "Cash"], ["gcash", "GCash"], ["maya", "Maya"], ["card", "Card"], ["other", "Other"]];
const JOB_STATUSES = [["received", "Received"], ["in_progress", "In progress"], ["ready_for_pickup", "Ready for pickup"], ["released", "Released"]];
const FUND_CATEGORIES = [
  ["capital", "Capital injection"], ["owner_withdrawal", "Owner withdrawal"], ["expense", "Expense"],
  ["bank_deposit", "Bank deposit"], ["cash_sale", "Cash sale deposit"], ["refund", "Refund"], ["other", "Other"],
];
const labelOf = (pairs, v) => pairs.find((p) => p[0] === v)?.[1] || v;

const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" }) : "";

/* Warranty status from a start time + duration in days.
   start = sale date (items) or release date (repairs). null start = not started yet. */
function warrantyInfo(startTs, days) {
  const d = parseInt(days, 10) || 0;
  if (d <= 0) return null;                            // no warranty offered
  if (!startTs) return { days: d, started: false };   // e.g. repair not released yet
  const expiry = new Date(startTs).getTime() + d * 86400000;
  const daysLeft = Math.ceil((expiry - Date.now()) / 86400000);
  return { days: d, started: true, expiry, active: daysLeft > 0, daysLeft };
}

/* Read an image file into an <img> element (data URL backed). */
function loadImage(file, validateType = true) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file"));
    if (validateType && !file.type.startsWith("image/")) return reject(new Error("Please choose an image file"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded"));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Aspect-preserving photo capped on the long edge — detailed enough to read a
// crack / serial number when zoomed, still reasonable to store. Used for repairs.
const PHOTO_MAX = 1280;
async function fileToPhoto(file) {
  if (!file) return null;
  const img = await loadImage(file);
  const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

// Short client-side id for records created in the UI (attachments, parts, links).
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- repair-job attachments (photos + PDF/Word/Excel docs) ---------- */
// Documents can't be recompressed like photos, so cap their raw size — they're
// stored inline (data URL) alongside the job, same as repair photos.
const DOC_MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const ATTACH_ACCEPT =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const isImageFile = (type = "", name = "") =>
  type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name);
const docKind = (name = "") => {
  const ext = (name.split(".").pop() || "").toUpperCase();
  return ext && ext !== name.toUpperCase() ? ext : "FILE";
};

/* Read one picked file into an attachment record. Photos go through the same
   resize pipeline as repair images; documents are stored as-is (size-capped). */
async function fileToAttachment(file) {
  if (isImageFile(file.type, file.name)) {
    const url = await fileToPhoto(file);
    return { id: rid(), name: file.name, kind: "image", url };
  }
  if (file.size > DOC_MAX_BYTES)
    throw new Error(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — documents are limited to 4 MB.`);
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read "${file.name}"`));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  return { id: rid(), name: file.name, kind: "doc", url };
}

/* ---------- data hook ---------- */
// How often live data is quietly re-fetched so other devices/branches show up
// (mock mode is single-device, so polling there is pointless). 20s keeps the
// dashboard, sales and stock close to real-time without hammering the server.
const LIVE_REFRESH_MS = 20000;

function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // First load shows a spinner; background refreshes (focus/poll) stay silent
  // so the screen doesn't flicker while someone is using it.
  const reload = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    try { setData(await api.get(path)); setError(null); }
    catch (e) { if (!background) setError(e.message); }
    finally { if (!background) setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  // Keep live data fresh across devices: refetch on tab focus + on an interval.
  useEffect(() => {
    if (MOCK) return; // standalone mock is local-only — nothing to poll for
    const refresh = () => reload({ background: true });
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, LIVE_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(id);
    };
  }, [reload]);
  return { data, error, loading, reload };
}

async function act(fn) {
  try { await fn(); }
  catch (e) { window.alert(e.message || "Something went wrong"); }
}

// Light/dark theme — flips data-theme on <html>, persisted in localStorage.
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("shopops-theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return { theme, toggle };
}

/* ---------- UI atoms ---------- */
const Card = ({ children, className = "", style = {}, ...rest }) => (
  <div {...rest} className={`rounded-xl ${className}`} style={{ background: C.surface, border: `1px solid ${C.line}`, ...style }}>{children}</div>
);
const Label = ({ children }) => (
  <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: C.muted }}>{children}</div>
);
const Input = (props) => (
  <input {...props} className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className || ""}`}
    style={{ border: `1px solid ${C.line}`, background: "var(--c-input)", color: C.ink, ...props.style }} />
);
const Select = ({ children, ...props }) => (
  <select {...props} className="w-full rounded-lg px-3 py-2 text-sm outline-none"
    style={{ border: `1px solid ${C.line}`, background: "var(--c-input)", color: C.ink }}>{children}</select>
);
const Textarea = (props) => (
  <textarea {...props} className={`w-full rounded-lg px-3 py-2 text-sm outline-none ${props.className || ""}`}
    rows={props.rows || 2}
    style={{ border: `1px solid ${C.line}`, background: "var(--c-input)", color: C.ink, resize: "vertical", ...props.style }} />
);
const Btn = ({ children, kind = "primary", className = "", ...props }) => {
  const styles = {
    primary: { background: C.brand, color: "#fff" },
    amber: { background: C.amber, color: "#fff" },
    ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.line}` },
    danger: { background: C.redSoft, color: C.red },
  };
  return (
    <button {...props} className={`rounded-lg px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${className}`} style={styles[kind]}>
      {children}
    </button>
  );
};
const Badge = ({ children, tone = "neutral" }) => {
  const tones = {
    neutral: { background: "var(--c-track)", color: C.muted }, green: { background: C.greenSoft, color: C.green },
    red: { background: C.redSoft, color: C.red }, amber: { background: C.amberSoft, color: "var(--c-amber-text)" },
  };
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={tones[tone]}>{children}</span>;
};
/* Warranty badge for a sold item or a repair job. */
const WarrantyTag = ({ start, days }) => {
  const w = warrantyInfo(start, days);
  if (!w) return null;
  if (!w.started) return <Badge tone="amber">Warranty {w.days}d (from release)</Badge>;
  return <Badge tone={w.active ? "green" : "red"}>{w.active ? `Warranty ${w.daysLeft}d left` : "Warranty expired"} · until {fmtDate(w.expiry)}</Badge>;
};
/* ---------- lightbox (full-screen zoom for any product/repair photo) ---------- */
const LightboxContext = React.createContext(() => {});
const useLightbox = () => React.useContext(LightboxContext);

function LightboxProvider({ children }) {
  const [box, setBox] = useState(null); // { images: [url], index }
  const open = useCallback((images, index = 0) => {
    const arr = (Array.isArray(images) ? images : [images]).filter(Boolean);
    if (arr.length) setBox({ images: arr, index: Math.min(index, arr.length - 1) });
  }, []);
  const close = useCallback(() => setBox(null), []);
  const step = useCallback((dir) => setBox((b) => b && { ...b, index: (b.index + dir + b.images.length) % b.images.length }), []);

  useEffect(() => {
    if (!box) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box, close, step]);

  return (
    <LightboxContext.Provider value={open}>
      {children}
      {box && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(8,20,24,0.92)" }} onClick={close}>
          <button onClick={close} className="absolute top-3 right-3 p-2 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }} title="Close (Esc)"><X size={20} /></button>
          {box.images.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); step(-1); }} className="absolute left-3 p-2 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}><ChevronRight size={22} style={{ transform: "rotate(180deg)" }} /></button>
              <button onClick={(e) => { e.stopPropagation(); step(1); }} className="absolute right-3 p-2 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}><ChevronRight size={22} /></button>
              <div className="absolute bottom-4 text-xs px-2 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.12)", color: "#fff" }}>{box.index + 1} / {box.images.length}</div>
            </>
          )}
          <img src={box.images[box.index]} alt="" className="max-w-full max-h-full rounded-lg object-contain" style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </LightboxContext.Provider>
  );
}

/* Multiple photos for a record (repairs). value/onChange = array of data URLs. */
function MultiImagePicker({ value = [], onChange, max = 10, thumb = 56 }) {
  const inputRef = React.useRef(null);
  const openLightbox = useLightbox();
  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = Math.max(0, max - value.length);
    if (room === 0) { window.alert(`Up to ${max} photos per record.`); return; }
    try {
      const urls = await Promise.all(files.slice(0, room).map((f) => fileToPhoto(f)));
      onChange([...value, ...urls]);
      if (files.length > room) window.alert(`Only ${max} photos per record — ${files.length - room} were skipped.`);
    } catch (err) { window.alert(err.message || "Couldn't add those photos"); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((src, i) => (
        <div key={i} className="relative group">
          <button type="button" onClick={() => openLightbox(value, i)} title="Tap to zoom">
            <Thumb src={src} size={thumb} />
          </button>
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))} title="Remove"
            className="absolute -top-1.5 -right-1.5 rounded-full p-0.5" style={{ background: C.red, color: "#fff" }}><X size={11} /></button>
        </div>
      ))}
      {value.length < max && (
        <>
          <input ref={inputRef} type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={pick} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className="rounded-lg flex flex-col items-center justify-center shrink-0"
            style={{ width: thumb, height: thumb, border: `1px dashed ${C.line}`, color: C.muted, background: "var(--c-input)" }} title="Add photos">
            <Plus size={16} /><span style={{ fontSize: 9 }}>Photo</span>
          </button>
        </>
      )}
    </div>
  );
}

/* Photos + PDF/Word/Excel documents for a record (repairs). value/onChange =
   array of {id, name, kind: "image"|"doc", url} stored inline with the job.
   Images zoom in the lightbox; documents download with their original name. */
function AttachmentPicker({ value = [], onChange, max = 12, thumb = 56 }) {
  const inputRef = React.useRef(null);
  const openLightbox = useLightbox();
  const imageUrls = value.filter((a) => a.kind === "image").map((a) => a.url);
  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const room = Math.max(0, max - value.length);
    if (room === 0) { window.alert(`Up to ${max} attachments per record.`); return; }
    const added = [];
    for (const f of files.slice(0, room)) {
      try { added.push(await fileToAttachment(f)); }
      catch (err) { window.alert(err.message || `Couldn't add "${f.name}"`); }
    }
    if (added.length) onChange([...value, ...added]);
    if (files.length > room) window.alert(`Only ${max} attachments per record — ${files.length - room} were skipped.`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((a) => (
        <div key={a.id} className="relative group">
          {a.kind === "image" ? (
            <button type="button" onClick={() => openLightbox(imageUrls, imageUrls.indexOf(a.url))} title={`${a.name} — tap to zoom`}>
              <Thumb src={a.url} size={thumb} />
            </button>
          ) : (
            <a href={a.url} download={a.name} title={`Download ${a.name}`}
              className="rounded-lg flex flex-col items-center justify-center shrink-0"
              style={{ width: thumb, height: thumb, border: `1px solid ${C.line}`, background: "#EDF1F1", color: C.inkSoft }}>
              <FileText size={Math.round(thumb * 0.34)} />
              <span className="font-bold" style={{ fontSize: 9 }}>{docKind(a.name)}</span>
            </a>
          )}
          <button type="button" onClick={() => onChange(value.filter((x) => x.id !== a.id))} title="Remove"
            className="absolute -top-1.5 -right-1.5 rounded-full p-0.5" style={{ background: C.red, color: "#fff" }}><X size={11} /></button>
        </div>
      ))}
      {value.length < max && (
        <>
          <input ref={inputRef} type="file" accept={ATTACH_ACCEPT} multiple className="hidden" onChange={pick} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className="rounded-lg flex flex-col items-center justify-center shrink-0"
            style={{ width: thumb, height: thumb, border: `1px dashed ${C.line}`, color: C.muted, background: "#FBFCFC" }} title="Add photos or PDF/Word/Excel documents">
            <Paperclip size={16} /><span style={{ fontSize: 9 }}>File</span>
          </button>
        </>
      )}
    </div>
  );
}

/* Parts replaced / changed during a repair. value/onChange = [{id, name, qty, cost}]. */
function PartsReplaced({ value = [], onChange }) {
  const [p, setP] = useState({ name: "", qty: "1", cost: "" });
  const submit = () => {
    if (!p.name.trim()) return;
    onChange([...value, { id: rid(), name: p.name.trim(), qty: parseInt(p.qty, 10) || 1, cost: +p.cost || 0 }]);
    setP({ name: "", qty: "1", cost: "" });
  };
  const total = value.reduce((a, x) => a + (x.cost || 0) * (x.qty || 1), 0);
  return (
    <div>
      {value.length > 0 && (
        <div className="space-y-1 mb-2">
          {value.map((x) => (
            <div key={x.id} className="flex justify-between items-center text-sm px-2 py-1 rounded-lg" style={{ background: "#F7F9F9" }}>
              <span>{x.name} <span className="text-xs" style={{ color: C.muted }}>× {x.qty}</span></span>
              <span className="flex items-center gap-2">
                {x.cost > 0 && <span className="font-medium">{peso(x.cost * x.qty)}</span>}
                <button type="button" onClick={() => onChange(value.filter((y) => y.id !== x.id))} title="Remove"><X size={13} color={C.red} /></button>
              </span>
            </div>
          ))}
          {total > 0 && <div className="text-xs text-right font-medium" style={{ color: C.muted }}>Parts total {peso(total)}</div>}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input placeholder="Part (e.g. charging port)" value={p.name}
          onChange={(e) => setP({ ...p, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <div style={{ width: 56 }}><Input type="number" min="1" title="Quantity" value={p.qty} onChange={(e) => setP({ ...p, qty: e.target.value })} /></div>
        <div style={{ width: 88 }}><Input type="number" placeholder="Cost ₱" value={p.cost}
          onChange={(e) => setP({ ...p, cost: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        <Btn kind="ghost" type="button" onClick={submit} title="Add part"><Plus size={14} /></Btn>
      </div>
    </div>
  );
}

/* Reference video links for warranty / troubleshooting.
   value/onChange = [{id, url?, path?, label}] — `url` for web links, `path` for
   local files (e.g. C:\Users\DELL\Videos\Screen Recordings\fix.mp4), which are
   streamed through the app server (browsers block direct file:/// links). */
const isLocalPath = (s) => /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\");
const localMediaUrl = (p) => "/local-media?p=" + encodeURIComponent(p);
const baseName = (p) => p.split(/[\\/]/).pop() || p;

function VideoLinks({ value = [], onChange }) {
  const [v, setV] = useState({ url: "", label: "" });
  const submit = () => {
    const raw = v.url.trim().replace(/^"|"$/g, ""); // tolerate Explorer "Copy as path" quotes
    if (!raw) return;
    const entry = isLocalPath(raw)
      ? { id: rid(), path: raw, label: v.label.trim() }
      : { id: rid(), url: /^https?:\/\//i.test(raw) ? raw : "https://" + raw, label: v.label.trim() };
    onChange([...value, entry]);
    setV({ url: "", label: "" });
  };
  return (
    <div>
      {value.length > 0 && (
        <div className="space-y-1 mb-2">
          {value.map((l) => (
            <div key={l.id} className="flex justify-between items-center text-sm px-2 py-1 rounded-lg" style={{ background: "#F7F9F9" }}>
              <a href={l.path ? localMediaUrl(l.path) : l.url} target="_blank" rel="noreferrer"
                title={l.path || l.url} className="flex items-center gap-1.5 truncate font-medium" style={{ color: C.amber }}>
                <Video size={13} className="shrink-0" /> <span className="truncate">{l.label || (l.path ? baseName(l.path) : l.url)}</span>
                {l.path && <Badge tone="neutral">local</Badge>}
              </a>
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== l.id))} title="Remove" className="ml-2 shrink-0"><X size={13} color={C.red} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <Input placeholder={"Video URL or local path (C:\\Users\\DELL\\Videos\\...)"} value={v.url}
          onChange={(e) => setV({ ...v, url: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <div style={{ width: 110 }}><Input placeholder="Label" value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        <Btn kind="ghost" type="button" onClick={submit} title="Add link"><Plus size={14} /></Btn>
      </div>
    </div>
  );
}

/* Small product thumbnail with a neutral placeholder when there's no image. */
const Thumb = ({ src, alt = "", size = 40 }) => (
  <div className="rounded-lg overflow-hidden flex items-center justify-center shrink-0"
    style={{ width: size, height: size, background: "var(--c-track)", border: `1px solid ${C.line}` }}>
    {src
      ? <img src={src} alt={alt} className="w-full h-full object-cover" />
      : <ImageIcon size={Math.round(size * 0.45)} color={C.line} />}
  </div>
);

/* Pick / change / remove a product photo. `value` is a data-URL (or null).
   Stored full-resolution so it zooms crisply in the lightbox, same as repairs. */
function ImagePicker({ value, onChange, size = 64 }) {
  const inputRef = React.useRef(null);
  const openLightbox = useLightbox();
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    try { onChange(await fileToPhoto(file)); }
    catch (err) { window.alert(err.message || "Couldn't use that image"); }
  };
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => value && openLightbox(value)} title={value ? "Tap to zoom" : ""} style={{ cursor: value ? "pointer" : "default" }}>
        <Thumb src={value} size={size} />
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={pick} />
      <div className="flex gap-2">
        <Btn kind="ghost" type="button" onClick={() => inputRef.current?.click()}>
          <ImageIcon size={14} className="inline mr-1" />{value ? "Change" : "Add photo"}
        </Btn>
        {value && <Btn kind="ghost" type="button" onClick={() => onChange("")} title="Remove photo"><X size={14} /></Btn>}
      </div>
    </div>
  );
}
const Empty = ({ text }) => <div className="text-sm py-8 text-center" style={{ color: C.muted }}>{text}</div>;
const Loading = () => <div className="text-sm py-8 text-center" style={{ color: C.muted }}>Loading…</div>;
const ErrorBox = ({ error, onRetry }) => (
  <Card className="p-3 flex items-center justify-between" style={{ borderColor: C.red, background: C.redSoft }}>
    <span className="text-sm" style={{ color: C.red }}>{error}</span>
    {onRetry && <Btn kind="ghost" onClick={onRetry}><RefreshCw size={13} className="inline mr-1" />Retry</Btn>}
  </Card>
);

/* ---------- dual clock ---------- */
function DualClock() {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  const fmt = (tz) => new Date().toLocaleTimeString("en-PH", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const phHour = phNow().getHours();
  const shopState = phHour >= 9 && phHour < 20 ? { txt: "Shop hours", tone: "green" } : { txt: "Shop closed", tone: "neutral" };
  return (
    <div className="flex items-center gap-3 text-xs" style={{ color: "#C8D4D6" }}>
      <span className="flex items-center gap-1"><Clock size={12} /> Makkah {fmt("Asia/Riyadh")}</span>
      <span style={{ opacity: 0.5 }}>•</span>
      <span>Manila {fmt("Asia/Manila")}</span>
      <Badge tone={shopState.tone}>{shopState.txt}</Badge>
    </div>
  );
}

/* ============================================================ */
export default function ShopOps() {
  const { user, logout, noAuth } = useAuth();
  const [view, setView] = useState("dashboard");
  const branches = useResource("/branches");
  const [activeBranch, setAB] = useState(getActiveBranch());
  const isManager = user?.role === "owner" || user?.role === "manager";
  const isOwner = user?.role === "owner";

  // default the active branch to the first one once branches load
  useEffect(() => {
    if (!activeBranch && branches.data?.length) {
      const id = branches.data[0].id;
      setActiveBranch(id); setAB(id);
    }
  }, [branches.data, activeBranch]);

  const branchObj = branches.data?.find((b) => b.id === activeBranch) || branches.data?.[0];
  const changeBranch = (id) => { setActiveBranch(id); setAB(id); };
  const reset = () => { if (window.confirm("Reset all demo data back to the starting sample set?")) act(async () => { await resetDemo(); window.location.reload(); }); };

  const NAV = [
    ["dashboard", "Overview", LayoutDashboard],
    ["pos", "Sales", ShoppingCart],
    ["stocks", "Stocks", Package],
    ["transfers", "Transfers", ArrowRightLeft],
    ["services", "Repair logs", Wrench],
    ["materials", "Materials orders", ClipboardList],
    ["customers", "Customers", UserRound],
    ["funds", "Fund movement", ArrowLeftRight],
    ["bills", "Bills", Receipt],
    ["backlogs", "Backlogs", ListTodo],
    ["closing", "Cash closing", Lock],
    ["performance", "Performance", TrendingUp],
    ["ratings", "Ratings", Star],
    ["reports", "Reports", FileSpreadsheet],
    ["staff", "Staff", Users],
  ];

  return (
    <LightboxProvider>
    <div className="min-h-screen" style={{ background: C.bg, color: C.ink, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');
        *::-webkit-scrollbar{height:4px;width:4px} *::-webkit-scrollbar-thumb{background:${C.line};border-radius:4px}`}</style>

      {/* header */}
      <div style={{ background: C.brand }} className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 max-w-5xl mx-auto">
          <div className="min-w-0">
            <div className="text-lg font-bold text-white leading-tight truncate">{branchObj?.name || "ShopOps"}</div>
            <div className="text-xs" style={{ color: "#9FB3B7" }}>{branchObj?.city || "Philippines"}</div>
          </div>
          <div className="flex items-center gap-2">
            {branches.data?.length > 1 && (
              <select value={activeBranch || ""} onChange={(e) => changeBranch(e.target.value)}
                className="rounded-lg px-2 py-1 text-xs outline-none" style={{ background: C.brandSoft, color: "#fff", border: `1px solid ${C.brandSoft}` }} title="Switch branch">
                {branches.data.map((b) => <option key={b.id} value={b.id} style={{ color: C.ink }}>{b.name}</option>)}
              </select>
            )}
            <div className="text-right hidden sm:block">
              <div className="text-xs text-white font-medium">{user?.full_name}</div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "#9FB3B7" }}>{ROLE_LABELS[user?.role] || user?.role}</div>
            </div>
            {noAuth && <button onClick={reset} title="Reset demo data" className="p-2 rounded-lg" style={{ color: "#9FB3B7" }}><RotateCcw size={15} /></button>}
            {!noAuth && <button onClick={logout} title="Log out" className="p-2 rounded-lg" style={{ color: "#9FB3B7" }}><LogOut size={15} /></button>}
          </div>
        </div>
        <div className="max-w-5xl mx-auto mt-2"><DualClock /></div>
      </div>

      {/* nav */}
      <div className="sticky top-0 z-10 px-2 py-2 overflow-x-auto" style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex gap-1 max-w-5xl mx-auto" style={{ minWidth: "max-content" }}>
          {NAV.map(([key, label, Icon]) => (
            <button key={key} onClick={() => setView(key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap"
              style={view === key ? { background: C.brand, color: "#fff" } : { color: C.muted }}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* content — keyed on branch so screens refetch when you switch branch */}
      <div key={activeBranch} className="px-4 py-4 max-w-5xl mx-auto pb-16">
        {view === "dashboard" && <Dashboard setView={setView} />}
        {view === "pos" && <POS branch={branchObj} />}
        {view === "stocks" && <Stocks isManager={isManager} />}
        {view === "transfers" && <Transfers branches={branches.data || []} activeBranch={activeBranch} />}
        {view === "services" && <Services branch={branchObj} />}
        {view === "materials" && <Materials isManager={isManager} />}
        {view === "customers" && <Customers />}
        {view === "funds" && <Funds />}
        {view === "bills" && <Bills />}
        {view === "backlogs" && <Backlogs setView={setView} />}
        {view === "closing" && <Closing />}
        {view === "performance" && <Performance />}
        {view === "ratings" && <Ratings />}
        {view === "reports" && <Reports />}
        {view === "staff" && <Staff isManager={isManager} isOwner={isOwner} branch={branchObj} reloadBranch={branches.reload} />}
      </div>
    </div>
    </LightboxProvider>
  );
}

/* ============================================================ DASHBOARD ========= */
function MiniChart() {
  const { data } = useResource("/dashboard/charts");
  if (!data) return null;
  const max = Math.max(...data.sales_trend.map((d) => d.total), 1);
  const topMax = Math.max(...data.top_products.map((p) => p.revenue), 1);
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      <Card className="p-3">
        <div className="font-bold text-sm mb-2 flex items-center gap-1.5"><BarChart3 size={14} /> Sales — last 14 days</div>
        <div className="flex items-end gap-1" style={{ height: 90 }}>
          {data.sales_trend.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${d.label}: ${peso(d.total)}`}>
              <div className="w-full rounded-t" style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 3 : 0, background: C.amber }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] mt-1" style={{ color: C.muted }}>
          <span>{data.sales_trend[0]?.label}</span><span>{data.sales_trend[data.sales_trend.length - 1]?.label}</span>
        </div>
      </Card>
      <Card className="p-3">
        <div className="font-bold text-sm mb-2">Top products — this month</div>
        {data.top_products.length === 0 ? <Empty text="No sales yet this month." /> : (
          <div className="space-y-2">
            {data.top_products.map((p, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm"><span>{p.name}</span><span className="font-medium">{peso(p.revenue)}</span></div>
                <div className="h-1.5 rounded-full mt-0.5" style={{ background: "var(--c-track)" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${(p.revenue / topMax) * 100}%`, background: C.ink }} />
                </div>
                <div className="text-[11px]" style={{ color: C.muted }}>{p.qty} sold</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Dashboard({ setView }) {
  const { data, error, loading, reload } = useResource("/dashboard");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data;
  const Stat = ({ label, value, sub, onClick }) => (
    <Card className="p-3 cursor-pointer" style={{ flex: "1 1 140px" }}>
      <div onClick={onClick}>
        <Label>{label}</Label>
        <div className="text-xl font-bold">{value}</div>
        {sub && <div className="text-xs mt-0.5" style={{ color: C.muted }}>{sub}</div>}
      </div>
    </Card>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Stat label="Sales today" value={peso(d.today.total)} sub={`${d.today.transactions} transaction${d.today.transactions === 1 ? "" : "s"}`} onClick={() => setView("pos")} />
        <Stat label="Cash to reconcile" value={peso(d.today.cash)} sub={d.closed_today ? "Day closed ✓" : "Not yet closed"} onClick={() => setView("closing")} />
        <Stat label="Open repair jobs" value={d.open_jobs} sub="In the repair logs" onClick={() => setView("services")} />
        <Stat label="Customer rating" value={d.avg_rating ? `${d.avg_rating} ★` : "—"} sub={d.avg_rating ? "average" : "No ratings yet"} onClick={() => setView("ratings")} />
      </div>

      <MiniChart />

      {!d.closed_today && (
        <Card className="p-3 flex items-center justify-between" style={{ borderColor: C.amber, background: C.amberSoft }}>
          <div className="text-sm font-medium" style={{ color: "var(--c-amber-text)" }}>Today's cash closing is still open</div>
          <Btn kind="amber" onClick={() => setView("closing")}>Close the day</Btn>
        </Card>
      )}

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-sm flex items-center gap-1.5"><AlertTriangle size={14} color={C.red} /> Red flags — last 7 days</div>
          <Badge tone={d.red_flags.length ? "red" : "green"}>{d.red_flags.length ? `${d.red_flags.length} to review` : "All clear"}</Badge>
        </div>
        {d.red_flags.length === 0 ? <Empty text="No voids or stock adjustments this week." /> : (
          <div className="space-y-1.5">
            {d.red_flags.slice(0, 8).map((f, i) => (
              <div key={i} className="text-sm flex justify-between gap-2 py-1" style={{ borderBottom: `1px solid ${C.line}` }}>
                <span>{f.flag_type === "voided_sale" ? `Voided sale ${peso(f.amount)}` : `Stock adjusted ${f.amount > 0 ? "+" : ""}${f.amount}`} — "{f.detail || "no reason"}" <span className="text-xs" style={{ color: C.muted }}>· {f.by_user}</span></span>
                <span className="text-xs whitespace-nowrap" style={{ color: C.muted }}>{fmtDT(f.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Card className="p-3">
          <div className="font-bold text-sm mb-2">Low stock ({d.low_stock.length})</div>
          {d.low_stock.length === 0 ? <Empty text="All items above minimum." /> : (
            <div className="space-y-1">
              {d.low_stock.map((p) => (
                <div key={p.sku} className="flex justify-between text-sm py-1"><span>{p.product}</span><Badge tone="red">{p.quantity} left</Badge></div>
              ))}
            </div>
          )}
          <button onClick={() => setView("stocks")} className="text-xs mt-2 flex items-center gap-1 font-medium" style={{ color: C.amber }}>Go to stocks <ChevronRight size={12} /></button>
        </Card>
        <Card className="p-3">
          <div className="font-bold text-sm mb-2">Bills unpaid ({d.unpaid_bills.length})</div>
          {d.unpaid_bills.length === 0 ? <Empty text="Nothing pending." /> : (
            <div className="space-y-1">
              {d.unpaid_bills.slice(0, 6).map((b) => (
                <div key={b.id} className="flex justify-between text-sm py-1"><span>{b.name}</span><span className="font-medium">{peso(b.amount)}</span></div>
              ))}
            </div>
          )}
          <button onClick={() => setView("bills")} className="text-xs mt-2 flex items-center gap-1 font-medium" style={{ color: C.amber }}>Go to bills <ChevronRight size={12} /></button>
        </Card>
      </div>
    </div>
  );
}

/* ============================================================ SALES / POS ======= */
function POS({ branch }) {
  const inv = useResource("/inventory");
  const sales = useResource("/sales");
  const [cart, setCart] = useState([]);
  const [method, setMethod] = useState("cash");
  const [discount, setDiscount] = useState("");
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  // recent-sales filters
  const [hSearch, setHSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const products = (inv.data || []).filter((p) => p.quantity > 0 &&
    (p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || "").toLowerCase().includes(search.toLowerCase())));

  const addToCart = (p) => setCart((c) => {
    const ex = c.find((i) => i.product_id === p.product_id);
    const inCart = ex ? ex.qty : 0;
    if (inCart >= p.quantity) { window.alert("No more stock for " + p.name); return c; }
    return ex ? c.map((i) => (i.product_id === p.product_id ? { ...i, qty: i.qty + 1 } : i))
      : [...c, { product_id: p.product_id, name: p.name, price: Number(p.selling_price), qty: 1 }];
  });

  const onScan = (e) => {
    if (e.key !== "Enter") return;
    const code = scan.trim().toLowerCase(); if (!code) return;
    const p = (inv.data || []).find((x) => (x.barcode || "").toLowerCase() === code || (x.sku || "").toLowerCase() === code);
    setScan("");
    if (!p) { window.alert("No product with code " + code); return; }
    addToCart(p);
  };

  const subtotal = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const disc = Math.max(0, Math.min(Number(discount) || 0, subtotal));
  const total = subtotal - disc;

  const checkout = () => act(async () => {
    if (!cart.length) return;
    await api.post("/sales", { payment_method: method, discount: disc, items: cart.map((i) => ({ product_id: i.product_id, quantity: i.qty })) });
    setCart([]); setDiscount(""); await Promise.all([inv.reload(), sales.reload()]);
  });
  const voidSale = (s) => {
    const reason = window.prompt("Reason for voiding this sale (required):");
    if (!reason) return;
    act(async () => { await api.post(`/sales/${s.id}/void`, { reason }); await Promise.all([inv.reload(), sales.reload()]); });
  };

  const filteredSales = (sales.data || []).filter((s) => {
    if (from && phDate(s.created_at) < from) return false;
    if (to && phDate(s.created_at) > to) return false;
    if (hSearch) {
      const t = hSearch.toLowerCase();
      const hit = s.payment_method.includes(t) || s.items.some((i) => i.name.toLowerCase().includes(t)) || String(s.sale_number).includes(t);
      if (!hit) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="font-bold text-sm mb-2">New sale</div>
        {inv.error && <ErrorBox error={inv.error} onRetry={inv.reload} />}
        <div className="flex items-center gap-1 mb-2 rounded-lg px-2" style={{ border: `1px solid ${C.line}`, background: "var(--c-input)" }}>
          <ScanLine size={15} color={C.muted} />
          <input value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} placeholder="Scan / type barcode or SKU, press Enter"
            className="w-full py-2 text-sm outline-none bg-transparent" style={{ color: C.ink }} />
        </div>
        <Input placeholder="Search product or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
          {products.map((p) => (
            <button key={p.product_id} onClick={() => addToCart(p)} className="w-full flex justify-between items-center gap-2 text-sm px-2 py-1.5 rounded-lg text-left" style={{ background: "var(--c-subtle)" }}>
              <span className="flex items-center gap-2 min-w-0">
                <Thumb src={p.image} alt={p.name} size={32} />
                <span className="truncate">{p.name} <span className="text-xs" style={{ color: C.muted }}>({p.quantity} in stock)</span></span>
              </span>
              <span className="font-medium shrink-0">{peso(p.selling_price)}</span>
            </button>
          ))}
          {inv.data && products.length === 0 && <Empty text="No matching products in stock." />}
        </div>
        {cart.length > 0 && (
          <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${C.line}` }}>
            {cart.map((i) => (
              <div key={i.product_id} className="flex items-center justify-between text-sm">
                <span>{i.name} × {i.qty}</span>
                <span className="flex items-center gap-2">{peso(i.price * i.qty)}
                  <button onClick={() => setCart((c) => c.filter((x) => x.product_id !== i.product_id))}><X size={14} color={C.red} /></button>
                </span>
              </div>
            ))}
            <div className="flex justify-between text-sm pt-1"><span style={{ color: C.muted }}>Subtotal</span><span>{peso(subtotal)}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Discount ₱</Label><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></div>
              <div><Label>Payment</Label>
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {PAYMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </div>
            </div>
            <Btn kind="amber" className="w-full" onClick={checkout}>Record sale — {peso(total)}</Btn>
          </div>
        )}
      </Card>

      <Card className="p-3">
        <div className="font-bold text-sm mb-2">Recent sales</div>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="col-span-3 sm:col-span-1 flex items-center gap-1 rounded-lg px-2" style={{ border: `1px solid ${C.line}`, background: "var(--c-input)" }}>
            <Search size={14} color={C.muted} />
            <input value={hSearch} onChange={(e) => setHSearch(e.target.value)} placeholder="Search…" className="w-full py-2 text-sm outline-none bg-transparent" />
          </div>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {sales.loading ? <Loading /> : filteredSales.length === 0 ? <Empty text="No sales match." /> : (
          <div className="space-y-1.5">
            {filteredSales.slice(0, 50).map((s) => (
              <div key={s.id} className="flex justify-between items-center text-sm py-1.5" style={{ borderBottom: `1px solid ${C.line}`, opacity: s.is_voided ? 0.5 : 1 }}>
                <div>
                  <div className="font-medium">#{s.sale_number} · {peso(s.total_amount)} · {labelOf(PAYMENTS, s.payment_method)} {Number(s.discount) > 0 && <span className="text-xs" style={{ color: C.muted }}>(−{peso(s.discount)})</span>} {s.is_voided && <Badge tone="red">VOIDED</Badge>}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{s.items.map((i) => `${i.name}×${i.quantity}`).join(", ")} · {s.sold_by_name} · {fmtDT(s.created_at)}</div>
                  {!s.is_voided && s.items.some((i) => i.warranty_days > 0) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                      {s.items.filter((i) => i.warranty_days > 0).map((i, idx) => (
                        <span key={idx} className="flex items-center gap-1">
                          <span className="text-xs" style={{ color: C.muted }}>{i.name}:</span>
                          <WarrantyTag start={s.created_at} days={i.warranty_days} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => printReceipt(s, branch)} title="Print receipt"><Printer size={14} color={C.muted} /></button>
                  {!s.is_voided && <button onClick={() => voidSale(s)} className="text-xs font-medium" style={{ color: C.red }}>Void</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================ STOCKS ============ */
function Stocks({ isManager }) {
  const inv = useResource("/inventory");
  const openLightbox = useLightbox();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null); // product being edited
  const [f, setF] = useState({ sku: "", name: "", category: "", cost_price: "", selling_price: "", qty: "", min_stock: "3", warranty_days: "0", image: null });

  const addProduct = () => act(async () => {
    if (!f.name || !f.sku) return;
    await api.post("/products", { ...f, cost_price: +f.cost_price || 0, selling_price: +f.selling_price || 0, qty: +f.qty || 0, min_stock: +f.min_stock || 3 });
    setF({ sku: "", name: "", category: "", cost_price: "", selling_price: "", qty: "", min_stock: "3", warranty_days: "0", image: null }); setShowAdd(false); await inv.reload();
  });
  const saveEdit = () => act(async () => {
    await api.patch(`/products/${editing.product_id}`, { name: editing.name, cost_price: +editing.cost_price || 0, selling_price: +editing.selling_price || 0, barcode: editing.barcode, image: editing.image ?? null, warranty_days: +editing.warranty_days || 0 });
    setEditing(null); await inv.reload();
  });
  const restock = (p) => {
    const raw = window.prompt(`Stock received for "${p.name}". Quantity:`);
    const qty = parseInt(raw, 10); if (!qty || qty <= 0) return;
    act(async () => { await api.post(`/inventory/${p.product_id}/restock`, { quantity: qty }); await inv.reload(); });
  };
  const adjust = (p) => {
    const raw = window.prompt(`Adjust stock for "${p.name}" (current: ${p.quantity}).\nEnter change, e.g. +10 or -2:`);
    if (!raw) return; const delta = parseInt(raw, 10); if (!delta) return;
    const reason = window.prompt("Reason for adjustment (required — visible on the owner dashboard):"); if (!reason) return;
    act(async () => { await api.post(`/inventory/${p.product_id}/adjust`, { delta, reason }); await inv.reload(); });
  };
  const remove = (p) => {
    if (!window.confirm(`Remove "${p.name}" from the catalog?`)) return;
    act(async () => { await api.del(`/products/${p.product_id}`); await inv.reload(); });
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Inventory{inv.data ? ` (${inv.data.length} items)` : ""}</div>
        {isManager && <Btn kind="amber" onClick={() => setShowAdd(!showAdd)}><Plus size={14} className="inline mr-1" />Add product</Btn>}
      </div>
      {inv.error && <ErrorBox error={inv.error} onRetry={inv.reload} />}

      {showAdd && (
        <Card className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>SKU</Label><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="CHG-002" /></div>
            <div><Label>Category</Label><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Chargers" /></div>
          </div>
          <div><Label>Product name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Fast Charger 33W" /></div>
          <div><Label>Photo</Label><ImagePicker value={f.image} onChange={(image) => setF({ ...f, image })} /></div>
          <div className="grid grid-cols-4 gap-2">
            <div><Label>Cost ₱</Label><Input type="number" value={f.cost_price} onChange={(e) => setF({ ...f, cost_price: e.target.value })} /></div>
            <div><Label>Price ₱</Label><Input type="number" value={f.selling_price} onChange={(e) => setF({ ...f, selling_price: e.target.value })} /></div>
            <div><Label>Qty</Label><Input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></div>
            <div><Label>Min</Label><Input type="number" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></div>
          </div>
          <div><Label>Warranty when sold (days, 0 = none)</Label><Input type="number" value={f.warranty_days} onChange={(e) => setF({ ...f, warranty_days: e.target.value })} placeholder="e.g. 30" /></div>
          <Btn onClick={addProduct} className="w-full"><Check size={14} className="inline mr-1" />Save product</Btn>
        </Card>
      )}

      {editing && (
        <Card className="p-3 space-y-2" style={{ borderColor: C.amber }}>
          <div className="font-bold text-sm">Edit — {editing.sku}</div>
          <div><Label>Product name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
          <div><Label>Photo</Label><ImagePicker value={editing.image} onChange={(image) => setEditing({ ...editing, image })} /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Cost ₱</Label><Input type="number" value={editing.cost_price} onChange={(e) => setEditing({ ...editing, cost_price: e.target.value })} /></div>
            <div><Label>Price ₱</Label><Input type="number" value={editing.selling_price} onChange={(e) => setEditing({ ...editing, selling_price: e.target.value })} /></div>
            <div><Label>Barcode</Label><Input value={editing.barcode || ""} onChange={(e) => setEditing({ ...editing, barcode: e.target.value })} /></div>
          </div>
          <div><Label>Warranty when sold (days, 0 = none)</Label><Input type="number" value={editing.warranty_days ?? 0} onChange={(e) => setEditing({ ...editing, warranty_days: e.target.value })} placeholder="e.g. 30" /></div>
          <div className="flex gap-2">
            <Btn onClick={saveEdit}><Check size={14} className="inline mr-1" />Save changes</Btn>
            <Btn kind="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {inv.loading ? <Loading /> : (
        <Card className="p-1 overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 580 }}>
            <thead><tr style={{ color: C.muted }} className="text-left text-xs uppercase">
              <th className="p-2">Product</th><th className="p-2">Stock</th><th className="p-2">Cost</th><th className="p-2">Price</th><th className="p-2">Margin</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {(inv.data || []).map((p) => (
                <tr key={p.product_id} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => p.image && openLightbox(p.image)} title={p.image ? "Tap to zoom" : ""} style={{ cursor: p.image ? "pointer" : "default" }}>
                        <Thumb src={p.image} alt={p.name} size={40} />
                      </button>
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs" style={{ color: C.muted, fontFamily: "ui-monospace, monospace" }}>{p.sku} · {p.category || "—"}</div>
                        <div className="text-xs" style={{ color: C.muted }}>{p.warranty_days > 0 ? `Warranty ${p.warranty_days}d` : "No warranty"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-2">{p.quantity <= p.min_stock ? <Badge tone="red">{p.quantity}</Badge> : <Badge tone="green">{p.quantity}</Badge>}</td>
                  <td className="p-2">{peso(p.cost_price)}</td>
                  <td className="p-2 font-medium">{peso(p.selling_price)}</td>
                  <td className="p-2 text-xs" style={{ color: C.green }}>{p.cost_price > 0 ? Math.round(((p.selling_price - p.cost_price) / p.cost_price) * 100) + "%" : "—"}</td>
                  <td className="p-2">{isManager && (
                    <div className="flex gap-1 justify-end">
                      <Btn kind="ghost" onClick={() => restock(p)} title="Stock received">+ In</Btn>
                      <Btn kind="ghost" onClick={() => adjust(p)} title="Manual adjustment">Adjust</Btn>
                      <button onClick={() => setEditing({ ...p })} className="px-2" title="Edit details"><Pencil size={14} color={C.muted} /></button>
                      <button onClick={() => remove(p)} className="px-2" title="Remove"><Trash2 size={14} color={C.red} /></button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ============================================================ TRANSFERS ========= */
function Transfers({ branches, activeBranch }) {
  const transfers = useResource("/transfers");
  const inv = useResource("/inventory");
  const [showAdd, setShowAdd] = useState(false);
  const [toBranch, setToBranch] = useState("");
  const [lines, setLines] = useState([]);

  const others = branches.filter((b) => b.id !== activeBranch);
  const addLine = () => setLines((l) => [...l, { product_id: "", quantity: "" }]);
  const setLine = (i, patch) => setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i));

  const create = () => act(async () => {
    const items = lines.filter((l) => l.product_id && +l.quantity > 0).map((l) => ({ product_id: l.product_id, quantity: +l.quantity }));
    if (!toBranch || items.length === 0) { window.alert("Choose a destination branch and add items."); return; }
    await api.post("/transfers", { to_branch_id: toBranch, items });
    setShowAdd(false); setLines([]); setToBranch(""); await Promise.all([transfers.reload(), inv.reload()]);
  });
  const receive = (t) => { if (!window.confirm(`Receive transfer #${t.transfer_number} into this branch?`)) return;
    act(async () => { await api.post(`/transfers/${t.id}/receive`); await Promise.all([transfers.reload(), inv.reload()]); }); };
  const cancel = (t) => { if (!window.confirm(`Cancel transfer #${t.transfer_number}? Stock returns to the source.`)) return;
    act(async () => { await api.post(`/transfers/${t.id}/cancel`); await Promise.all([transfers.reload(), inv.reload()]); }); };

  const tone = (s) => (s === "received" ? "green" : s === "cancelled" ? "red" : "amber");

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Stock transfers</div>
        {others.length > 0 && <Btn kind="amber" onClick={() => { setShowAdd(!showAdd); if (!lines.length) addLine(); }}><Plus size={14} className="inline mr-1" />New transfer</Btn>}
      </div>
      {others.length === 0 && <Card><Empty text="Add a second branch (owner: Staff → Add branch) to transfer stock between locations." /></Card>}
      {transfers.error && <ErrorBox error={transfers.error} onRetry={transfers.reload} />}

      {showAdd && (
        <Card className="p-3 space-y-2">
          <div><Label>Send to branch</Label>
            <Select value={toBranch} onChange={(e) => setToBranch(e.target.value)}>
              <option value="">Choose destination…</option>
              {others.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <Label>Items (from this branch's stock)</Label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-1 items-center">
              <div className="col-span-8">
                <Select value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                  <option value="">Product…</option>
                  {(inv.data || []).map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({p.quantity} in stock)</option>)}
                </Select>
              </div>
              <div className="col-span-3"><Input type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
              <div className="col-span-1 text-center"><button onClick={() => removeLine(i)}><X size={14} color={C.red} /></button></div>
            </div>
          ))}
          <Btn kind="ghost" onClick={addLine}><Plus size={13} className="inline mr-1" />Add item</Btn>
          <Btn kind="amber" className="w-full" onClick={create}>Send transfer</Btn>
        </Card>
      )}

      {transfers.loading ? <Loading /> : !transfers.data || transfers.data.length === 0 ? (
        <Card><Empty text="No transfers yet. Move stock between branches and it stays audited at both ends." /></Card>
      ) : (
        <div className="space-y-2">
          {transfers.data.map((t) => (
            <Card key={t.id} className="p-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    #{t.transfer_number} · {t.from_branch_name} <ArrowRightLeft size={12} /> {t.to_branch_name}
                    <Badge tone={t.direction === "in" ? "green" : "neutral"}>{t.direction === "in" ? "Incoming" : "Outgoing"}</Badge>
                  </div>
                  <div className="text-xs" style={{ color: C.muted }}>{fmtDT(t.created_at)} · {t.requested_by_name}</div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>{t.items.map((i) => `${i.name}×${i.quantity}`).join(", ")}</div>
                </div>
                <Badge tone={tone(t.status)}>{t.status.replace(/_/g, " ")}</Badge>
              </div>
              {t.status === "in_transit" && (
                <div className="flex gap-1 mt-2">
                  {t.direction === "in" && <Btn kind="amber" onClick={() => receive(t)}>Receive into stock</Btn>}
                  <Btn kind="ghost" onClick={() => cancel(t)}>Cancel</Btn>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* Editable free-text details on a repair job: customer details, technician
   findings, notes, remarks, instructions. Shows a read-only summary until edited. */
const JOB_DETAIL_FIELDS = [
  ["customer_details", "Customer — additional details", "What the customer reported / agreed"],
  ["tech_notes", "Technician — findings / details", "Diagnosis, parts, observations"],
  ["notes", "Notes", ""],
  ["remarks", "Remarks", ""],
  ["instructions", "Instructions", "Handling / repair instructions"],
];
const JOB_ID_FIELDS = [
  ["model_number", "Model / board / chassis no.", "e.g. SM-A155F / board rev."],
  ["serial_code", "Serial / SKU code", "Serial no. or SKU code"],
  ["warranty_days", "Service warranty (days)", "0 = none"],
];
function JobDetails({ job, onSave }) {
  const blank = () => Object.fromEntries([...JOB_ID_FIELDS, ...JOB_DETAIL_FIELDS].map(([k]) => [k, job[k] || ""]));
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(blank);
  const start = () => { setD(blank()); setEditing(true); };
  const save = () => { onSave(d); setEditing(false); };
  const filled = JOB_DETAIL_FIELDS.filter(([k]) => (job[k] || "").trim());

  if (!editing) {
    return (
      <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
        {filled.length > 0 ? (
          <div className="space-y-1">
            {filled.map(([k, label]) => (
              <div key={k} className="text-xs">
                <span className="font-medium" style={{ color: C.muted }}>{label}: </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{job[k]}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs" style={{ color: C.muted }}>No customer/technician details yet.</div>
        )}
        <button onClick={start} className="text-xs mt-1 flex items-center gap-1 font-medium" style={{ color: C.amber }}>
          <Pencil size={11} /> {filled.length > 0 ? "Edit details" : "Add details"}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 pt-2 space-y-2" style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="grid grid-cols-2 gap-2">
        {JOB_ID_FIELDS.map(([k, label, ph]) => (
          <div key={k}><Label>{label}</Label><Input value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} placeholder={ph} /></div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {JOB_DETAIL_FIELDS.slice(0, 2).map(([k, label, ph]) => (
          <div key={k}><Label>{label}</Label><Textarea value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} placeholder={ph} /></div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {JOB_DETAIL_FIELDS.slice(2).map(([k, label, ph]) => (
          <div key={k}><Label>{label}</Label><Textarea value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} placeholder={ph} /></div>
        ))}
      </div>
      <div className="flex gap-2">
        <Btn onClick={save}><Check size={14} className="inline mr-1" />Save details</Btn>
        <Btn kind="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ============================================================ REPAIR LOGS ======= */
function Services({ branch }) {
  const jobs = useResource("/services");
  const staff = useResource("/staff");
  const customers = useResource("/customers");
  const openLightbox = useLightbox();
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ customer_id: "", customer: "", phone: "", device: "", model_number: "", serial_code: "", issue: "", fee: "", tech_id: "", images: [], attachments: [], customer_details: "", tech_notes: "", notes: "", remarks: "", instructions: "", warranty_days: "0" });
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("");
  const [refQ, setRefQ] = useState(""); // "past repairs" reference lookup
  const [showRef, setShowRef] = useState(false);

  const addJob = () => act(async () => {
    if ((!f.customer && !f.customer_id) || !f.device) { window.alert("Customer and device are required."); return; }
    await api.post("/services", { customer_id: f.customer_id || null, customer: f.customer || undefined, phone: f.phone || undefined, device: f.device, model_number: f.model_number, serial_code: f.serial_code, issue: f.issue, fee: +f.fee || 0, tech_id: f.tech_id || null, images: f.images, attachments: f.attachments, customer_details: f.customer_details, tech_notes: f.tech_notes, notes: f.notes, remarks: f.remarks, instructions: f.instructions, warranty_days: +f.warranty_days || 0 });
    setF({ customer_id: "", customer: "", phone: "", device: "", model_number: "", serial_code: "", issue: "", fee: "", tech_id: "", images: [], attachments: [], customer_details: "", tech_notes: "", notes: "", remarks: "", instructions: "", warranty_days: "0" }); setShowAdd(false); await jobs.reload();
  });
  const setStatus = (job, status) => act(async () => { await api.patch(`/services/${job.id}/status`, { status }); await jobs.reload(); });
  const saveImages = (job, images) => act(async () => { await api.patch(`/services/${job.id}/images`, { images }); await jobs.reload(); });
  const saveAttachments = (job, attachments) => act(async () => { await api.patch(`/services/${job.id}/attachments`, { attachments }); await jobs.reload(); });
  // Generic save for the repair-documentation arrays (parts, before/after photos, video links).
  const saveExtras = (job, field, list) => act(async () => { await api.patch(`/services/${job.id}/extras`, { [field]: list }); await jobs.reload(); });
  const saveDetails = (job, fields) => act(async () => { await api.patch(`/services/${job.id}/details`, fields); await jobs.reload(); });
  const pay = (job) => { const raw = window.prompt(`Record payment for ${job.customer} (balance ${peso(job.balance)}):`); const amt = Number(raw); if (!amt || amt <= 0) return;
    act(async () => { await api.post(`/services/${job.id}/payment`, { amount: amt }); await jobs.reload(); }); };
  const tone = (s) => (s === "released" ? "green" : s === "ready_for_pickup" ? "amber" : "neutral");

  const jobText = (j) => [j.customer, j.device, j.model_number, j.serial_code, j.issue, j.tech_notes, j.remarks]
    .filter(Boolean).join(" ").toLowerCase();
  const list = (jobs.data || []).filter((j) => {
    if (statusF && j.status !== statusF) return false;
    if (q && !jobText(j).includes(q.toLowerCase())) return false;
    return true;
  });

  // "Past repairs" reference — find earlier jobs matching the query by issue,
  // model/board/chassis or serial/SKU, so a technician can see how a repeat
  // case was handled before. Same-model/serial matches are surfaced first.
  const refTerms = refQ.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  const refMatches = !refQ.trim() ? [] : (jobs.data || [])
    .map((j) => {
      const id = `${j.model_number || ""} ${j.serial_code || ""}`.toLowerCase();
      const idHit = refTerms.some((t) => id.includes(t));
      const hay = jobText(j);
      const score = (idHit ? 100 : 0) + refTerms.filter((t) => hay.includes(t)).length;
      return { j, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.j.received_at) - new Date(a.j.received_at))
    .slice(0, 20)
    .map((m) => m.j);
  const lookupSimilar = (j) => { setRefQ([j.model_number, j.serial_code, j.issue].filter(Boolean).join(" ")); setShowRef(true); };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Repair logsheet</div>
        <Btn kind="amber" onClick={() => setShowAdd(!showAdd)}><Plus size={14} className="inline mr-1" />New job</Btn>
      </div>
      {jobs.error && <ErrorBox error={jobs.error} onRetry={jobs.reload} />}

      {showAdd && (
        <Card className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Existing customer</Label>
              <Select value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
                <option value="">— new / walk-in —</option>
                {(customers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
              </Select>
            </div>
            <div><Label>…or new name</Label><Input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} disabled={!!f.customer_id} placeholder="Walk-in name" /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Contact no.</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div><Label>Service fee ₱</Label><Input type="number" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></div>
            <div><Label>Service warranty (days, 0 = none)</Label><Input type="number" value={f.warranty_days} onChange={(e) => setF({ ...f, warranty_days: e.target.value })} placeholder="e.g. 30" /></div>
          </div>
          <div><Label>Device</Label><Input value={f.device} onChange={(e) => setF({ ...f, device: e.target.value })} placeholder="e.g. Redmi Note 12 — black" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Model / board / chassis no.</Label><Input value={f.model_number} onChange={(e) => setF({ ...f, model_number: e.target.value })} placeholder="e.g. SM-A155F / board rev." /></div>
            <div><Label>Serial / SKU code</Label><Input value={f.serial_code} onChange={(e) => setF({ ...f, serial_code: e.target.value })} placeholder="Serial no. or SKU code" /></div>
          </div>
          <div><Label>Issue reported</Label><Input value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} placeholder="e.g. cracked screen, no power" /></div>
          <div><Label>Warranty / fault photos</Label><MultiImagePicker value={f.images} onChange={(images) => setF({ ...f, images })} /></div>
          <div><Label>Attachments — photos &amp; PDF/Word/Excel docs</Label><AttachmentPicker value={f.attachments} onChange={(attachments) => setF({ ...f, attachments })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Customer — additional details</Label><Textarea value={f.customer_details} onChange={(e) => setF({ ...f, customer_details: e.target.value })} placeholder="What the customer reported / agreed" /></div>
            <div><Label>Technician — findings / details</Label><Textarea value={f.tech_notes} onChange={(e) => setF({ ...f, tech_notes: e.target.value })} placeholder="Diagnosis, parts, observations" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Notes</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
            <div><Label>Remarks</Label><Textarea value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></div>
            <div><Label>Instructions</Label><Textarea value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="Handling / repair instructions" /></div>
          </div>
          <div><Label>Technician</Label>
            <Select value={f.tech_id} onChange={(e) => setF({ ...f, tech_id: e.target.value })}>
              <option value="">Unassigned</option>
              {(staff.data || []).filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </div>
          <Btn onClick={addJob} className="w-full"><Check size={14} className="inline mr-1" />Log the job</Btn>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 flex items-center gap-1 rounded-lg px-2" style={{ border: `1px solid ${C.line}`, background: "var(--c-input)" }}>
          <Search size={14} color={C.muted} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / device / model / serial / issue…" className="w-full py-2 text-sm outline-none bg-transparent" />
        </div>
        <Select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">All statuses</option>
          {JOB_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>

      {/* Technician reference — look up past repairs with the same model/serial/issue */}
      <Card className="p-3" style={{ borderColor: C.amber, background: showRef ? C.surface : "var(--c-input)" }}>
        <button onClick={() => setShowRef((v) => !v)} className="w-full flex items-center justify-between text-sm font-bold">
          <span className="flex items-center gap-1.5"><Search size={14} color={C.amber} /> Past repairs reference — repeat / trouble cases</span>
          <ChevronRight size={16} style={{ transform: showRef ? "rotate(90deg)" : "none", color: C.muted }} />
        </button>
        {showRef && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-1 rounded-lg px-2" style={{ border: `1px solid ${C.line}`, background: "var(--c-input)" }}>
              <Search size={14} color={C.muted} />
              <input value={refQ} onChange={(e) => setRefQ(e.target.value)} autoFocus placeholder="Type a model / board / chassis, serial / SKU code, or issue…" className="w-full py-2 text-sm outline-none bg-transparent" />
              {refQ && <button onClick={() => setRefQ("")}><X size={14} color={C.muted} /></button>}
            </div>
            {!refQ.trim() ? (
              <div className="text-xs" style={{ color: C.muted }}>Search past jobs to see how the same model or fault was handled before — the technician's findings, remarks and instructions show below.</div>
            ) : refMatches.length === 0 ? (
              <Empty text="No earlier repairs match. This may be the first of its kind." />
            ) : (
              <div className="space-y-1.5">
                <div className="text-xs" style={{ color: C.muted }}>{refMatches.length} past record{refMatches.length === 1 ? "" : "s"} found</div>
                {refMatches.map((m) => (
                  <div key={m.id} className="text-xs rounded-lg p-2" style={{ background: "var(--c-subtle)" }}>
                    <div className="flex justify-between gap-2">
                      <span className="font-medium" style={{ color: C.ink }}>#{m.claim_number} · {m.device}{m.model_number ? ` · ${m.model_number}` : ""}{m.serial_code ? ` · ${m.serial_code}` : ""}</span>
                      <span className="whitespace-nowrap" style={{ color: C.muted }}>{fmtDT(m.received_at)}</span>
                    </div>
                    {m.issue && <div className="mt-0.5"><span style={{ color: C.muted }}>Issue: </span>{m.issue}</div>}
                    {m.tech_notes && <div className="mt-0.5"><span style={{ color: C.muted }}>Findings: </span><span style={{ whiteSpace: "pre-wrap" }}>{m.tech_notes}</span></div>}
                    {m.remarks && <div className="mt-0.5"><span style={{ color: C.muted }}>Remarks: </span><span style={{ whiteSpace: "pre-wrap" }}>{m.remarks}</span></div>}
                    {m.instructions && <div className="mt-0.5"><span style={{ color: C.muted }}>Instructions: </span><span style={{ whiteSpace: "pre-wrap" }}>{m.instructions}</span></div>}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone={tone(m.status)}>{labelOf(JOB_STATUSES, m.status)}</Badge>
                      <WarrantyTag start={m.released_at} days={m.warranty_days} />
                      {(m.images?.length > 0) && <button onClick={() => openLightbox(m.images, 0)} className="font-medium" style={{ color: C.amber }}>View {m.images.length} photo{m.images.length === 1 ? "" : "s"}</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {jobs.loading ? <Loading /> : list.length === 0 ? (
        <Card><Empty text="No repair jobs match. Log walk-in repairs so nothing gets lost." /></Card>
      ) : (
        <div className="space-y-2">
          {list.map((j) => (
            <Card key={j.id} className="p-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-medium text-sm">#{j.claim_number} · {j.device}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{j.customer}{j.phone ? ` · ${j.phone}` : ""} · in {fmtDT(j.received_at)}</div>
                  {(j.model_number || j.serial_code) && (
                    <div className="text-xs mt-0.5" style={{ color: C.muted, fontFamily: "ui-monospace, monospace" }}>
                      {j.model_number ? `Model ${j.model_number}` : ""}{j.model_number && j.serial_code ? " · " : ""}{j.serial_code ? `S/N ${j.serial_code}` : ""}
                    </div>
                  )}
                  <div className="text-sm mt-1">{j.issue}</div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>{j.tech_name || "Unassigned"} · Fee {peso(j.fee)} · Paid {peso(j.amount_paid)} · <span style={{ color: j.balance > 0 ? C.red : C.green }}>Bal {peso(j.balance)}</span></div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={tone(j.status)}>{labelOf(JOB_STATUSES, j.status)}</Badge>
                  <WarrantyTag start={j.released_at} days={j.warranty_days} />
                  <button onClick={() => printClaim(j, branch)} title="Print claim stub"><Printer size={14} color={C.muted} /></button>
                  <button onClick={() => lookupSimilar(j)} title="Find past repairs like this" className="text-xs font-medium flex items-center gap-0.5" style={{ color: C.amber }}><Search size={11} />Similar</button>
                </div>
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <Label>Warranty / fault photos{(j.images?.length) ? ` (${j.images.length})` : ""}</Label>
                <MultiImagePicker value={j.images || []} onChange={(images) => saveImages(j, images)} thumb={48} />
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <Label>Attachments — photos &amp; docs{(j.attachments?.length) ? ` (${j.attachments.length})` : ""}</Label>
                <AttachmentPicker value={j.attachments || []} onChange={(attachments) => saveAttachments(j, attachments)} thumb={48} />
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <Label>Parts replaced / changed{(j.parts_replaced?.length) ? ` (${j.parts_replaced.length})` : ""}</Label>
                <PartsReplaced value={j.parts_replaced || []} onChange={(list) => saveExtras(j, "parts_replaced", list)} />
              </div>
              <div className="mt-2 pt-2 grid grid-cols-2 gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <div>
                  <Label>Before service photos{(j.before_photos?.length) ? ` (${j.before_photos.length})` : ""}</Label>
                  <MultiImagePicker value={j.before_photos || []} onChange={(list) => saveExtras(j, "before_photos", list)} thumb={48} />
                </div>
                <div>
                  <Label>After service photos{(j.after_photos?.length) ? ` (${j.after_photos.length})` : ""}</Label>
                  <MultiImagePicker value={j.after_photos || []} onChange={(list) => saveExtras(j, "after_photos", list)} thumb={48} />
                </div>
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                <Label>Video links — warranty / troubleshooting{(j.video_links?.length) ? ` (${j.video_links.length})` : ""}</Label>
                <VideoLinks value={j.video_links || []} onChange={(list) => saveExtras(j, "video_links", list)} />
              </div>
              <JobDetails job={j} onSave={(fields) => saveDetails(j, fields)} />
              <div className="flex gap-1 mt-2 flex-wrap">
                {j.balance > 0 && <Btn kind="ghost" onClick={() => pay(j)}>Record payment</Btn>}
                {j.status !== "released" && JOB_STATUSES.filter(([v]) => v !== j.status).map(([v, l]) => (
                  <Btn key={v} kind="ghost" onClick={() => setStatus(j, v)}>{l} →</Btn>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ MATERIALS ORDERS == */
function Materials({ isManager }) {
  const pos = useResource("/purchase-orders");
  const suppliers = useResource("/suppliers");
  const inv = useResource("/inventory");
  const [showAdd, setShowAdd] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([]);
  const [newSupplier, setNewSupplier] = useState("");

  const addLine = () => setLines((l) => [...l, { product_id: "", qty_ordered: "", unit_cost: "" }]);
  const setLine = (i, patch) => setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i));
  const poTotal = lines.reduce((a, l) => a + (+l.unit_cost || 0) * (+l.qty_ordered || 0), 0);

  const addSupplier = () => act(async () => {
    if (!newSupplier.trim()) return;
    const s = await api.post("/suppliers", { name: newSupplier.trim() });
    setNewSupplier(""); await suppliers.reload(); setSupplierId(s.id);
  });
  const createPO = () => act(async () => {
    const items = lines.filter((l) => l.product_id && +l.qty_ordered > 0).map((l) => ({ product_id: l.product_id, qty_ordered: +l.qty_ordered, unit_cost: +l.unit_cost || 0 }));
    if (!supplierId || items.length === 0) { window.alert("Pick a supplier and add at least one item."); return; }
    await api.post("/purchase-orders", { supplier_id: supplierId, items, notes });
    setShowAdd(false); setLines([]); setNotes(""); setSupplierId(""); await pos.reload();
  });
  const receive = (po) => { if (!window.confirm(`Mark PO #${po.po_number} received and add all items to stock?`)) return;
    act(async () => { await api.post(`/purchase-orders/${po.id}/receive`); await Promise.all([pos.reload(), inv.reload()]); }); };
  const cancel = (po) => { if (!window.confirm(`Cancel PO #${po.po_number}?`)) return;
    act(async () => { await api.post(`/purchase-orders/${po.id}/cancel`); await pos.reload(); }); };
  const statusTone = (s) => (s === "received" ? "green" : s === "cancelled" ? "red" : "amber");

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Materials orders</div>
        {isManager && <Btn kind="amber" onClick={() => { setShowAdd(!showAdd); if (!lines.length) addLine(); }}><Plus size={14} className="inline mr-1" />New order</Btn>}
      </div>
      {pos.error && <ErrorBox error={pos.error} onRetry={pos.reload} />}

      {showAdd && (
        <Card className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 items-end">
            <div><Label>Supplier</Label>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose supplier…</option>
                {(suppliers.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="flex gap-1">
              <Input placeholder="…or add new supplier" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} />
              <Btn kind="ghost" onClick={addSupplier}><Plus size={14} /></Btn>
            </div>
          </div>
          <Label>Items</Label>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-center">
                <div className="col-span-6">
                  <Select value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                    <option value="">Product…</option>
                    {(inv.data || []).map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                  </Select>
                </div>
                <div className="col-span-2"><Input type="number" placeholder="Qty" value={l.qty_ordered} onChange={(e) => setLine(i, { qty_ordered: e.target.value })} /></div>
                <div className="col-span-3"><Input type="number" placeholder="Unit cost" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} /></div>
                <div className="col-span-1 text-center"><button onClick={() => removeLine(i)}><X size={14} color={C.red} /></button></div>
              </div>
            ))}
          </div>
          <Btn kind="ghost" onClick={addLine}><Plus size={13} className="inline mr-1" />Add item</Btn>
          <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" /></div>
          <Btn kind="amber" onClick={createPO} className="w-full">Create order — {peso(poTotal)}</Btn>
        </Card>
      )}

      {pos.loading ? <Loading /> : !pos.data || pos.data.length === 0 ? (
        <Card><Empty text="No materials orders yet. Track supplier purchases here; receiving an order adds stock automatically." /></Card>
      ) : (
        <div className="space-y-2">
          {pos.data.map((po) => (
            <Card key={po.id} className="p-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-medium text-sm">PO #{po.po_number} · {po.supplier_name}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{fmtDT(po.created_at)} · {po.created_by_name} · {peso(po.total_cost)}</div>
                  <div className="text-xs mt-1" style={{ color: C.muted }}>{po.items.map((i) => `${i.name}×${i.qty_ordered}`).join(", ")}</div>
                </div>
                <Badge tone={statusTone(po.status)}>{po.status.replace(/_/g, " ")}</Badge>
              </div>
              {isManager && po.status !== "received" && po.status !== "cancelled" && (
                <div className="flex gap-1 mt-2">
                  <Btn kind="amber" onClick={() => receive(po)}>Receive into stock</Btn>
                  <Btn kind="ghost" onClick={() => cancel(po)}>Cancel</Btn>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ CUSTOMERS ========= */
function Customers() {
  const [q, setQ] = useState("");
  const list = useResource("/customers");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", notes: "" });

  const filtered = (list.data || []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || "").includes(q));

  const add = () => act(async () => {
    if (!f.name) return;
    await api.post("/customers", f); setF({ name: "", phone: "", notes: "" }); setShowAdd(false); await list.reload();
  });
  const open = (c) => act(async () => { setSelected(await api.get(`/customers/${c.id}`)); });

  if (selected) {
    const { customer, jobs, total_spent } = selected;
    return (
      <div className="space-y-3">
        <button onClick={() => setSelected(null)} className="text-sm flex items-center gap-1" style={{ color: C.amber }}>← Back to customers</button>
        <Card className="p-3">
          <div className="text-lg font-bold">{customer.name}</div>
          <div className="text-sm" style={{ color: C.muted }}>{customer.phone || "No contact number"}</div>
          {customer.notes && <div className="text-sm mt-1">{customer.notes}</div>}
          <div className="flex gap-3 mt-2 text-sm">
            <span><span className="font-bold">{jobs.length}</span> repair{jobs.length === 1 ? "" : "s"}</span>
            <span>Total paid <span className="font-bold">{peso(total_spent)}</span></span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="font-bold text-sm mb-2">Repair history</div>
          {jobs.length === 0 ? <Empty text="No repairs logged for this customer yet." /> : (
            <div className="space-y-1.5">
              {jobs.map((j) => (
                <div key={j.id} className="flex justify-between items-center text-sm py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <div><span className="font-medium">{j.device}</span>
                    <div className="text-xs" style={{ color: C.muted }}>{j.issue || "—"} · {fmtDT(j.received_at)}</div></div>
                  <div className="text-right"><Badge tone={j.status === "released" ? "green" : "neutral"}>{labelOf(JOB_STATUSES, j.status)}</Badge>
                    <div className="text-xs mt-0.5" style={{ color: C.muted }}>{peso(j.fee)}</div></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Customers{list.data ? ` (${list.data.length})` : ""}</div>
        <Btn kind="amber" onClick={() => setShowAdd(!showAdd)}><Plus size={14} className="inline mr-1" />Add customer</Btn>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {showAdd && (
        <Card className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><Label>Contact no.</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          </div>
          <div><Label>Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="optional" /></div>
          <Btn onClick={add}><Check size={14} className="inline mr-1" />Save customer</Btn>
        </Card>
      )}
      <div className="flex items-center gap-1 rounded-lg px-2" style={{ border: `1px solid ${C.line}`, background: "var(--c-input)" }}>
        <Search size={14} color={C.muted} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number…" className="w-full py-2 text-sm outline-none bg-transparent" />
      </div>
      {list.loading ? <Loading /> : filtered.length === 0 ? <Card><Empty text="No customers match. Add repeat customers to track their repair history." /></Card> : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.id} className="p-3 flex justify-between items-center cursor-pointer" onClick={() => open(c)}>
              <div><div className="font-medium text-sm">{c.name}</div><div className="text-xs" style={{ color: C.muted }}>{c.phone || "—"}</div></div>
              <div className="flex items-center gap-2"><Badge tone="neutral">{c.visits} visit{c.visits === 1 ? "" : "s"}</Badge><ChevronRight size={14} color={C.muted} /></div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ FUND MOVEMENT ===== */
function Funds() {
  const funds = useResource("/funds");
  const [f, setF] = useState({ direction: "in", category: "capital", amount: "", notes: "" });

  const add = () => act(async () => {
    if (!+f.amount) return;
    await api.post("/funds", { ...f, amount: +f.amount });
    setF({ direction: "in", category: "capital", amount: "", notes: "" }); await funds.reload();
  });

  const t = funds.data?.totals;
  return (
    <div className="space-y-3">
      {funds.error && <ErrorBox error={funds.error} onRetry={funds.reload} />}
      <div className="flex flex-wrap gap-3">
        <Card className="p-3" style={{ flex: 1 }}><Label>Cash in</Label><div className="text-xl font-bold" style={{ color: C.green }}>{peso(t?.in)}</div></Card>
        <Card className="p-3" style={{ flex: 1 }}><Label>Cash out</Label><div className="text-xl font-bold" style={{ color: C.red }}>{peso(t?.out)}</div></Card>
        <Card className="p-3" style={{ flex: 1 }}><Label>Balance</Label><div className="text-xl font-bold">{peso(t?.balance)}</div></Card>
      </div>

      <Card className="p-3 space-y-2">
        <div className="font-bold text-sm">Record fund movement</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Direction</Label>
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="in">Cash in</option><option value="out">Cash out</option>
            </Select>
          </div>
          <div><Label>Category</Label>
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {FUND_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>Amount ₱</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><Label>Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="optional" /></div>
        </div>
        <Btn kind="amber" onClick={add}>Save movement</Btn>
      </Card>

      <Card className="p-3">
        <div className="font-bold text-sm mb-2">History</div>
        {funds.loading ? <Loading /> : !funds.data || funds.data.movements.length === 0 ? <Empty text="Record capital you put in, owner withdrawals, deposits and expenses — so the cash trail is always clear." /> : (
          <div className="space-y-1.5">
            {funds.data.movements.map((m) => (
              <div key={m.id} className="flex justify-between items-center text-sm py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                <div><span className="font-medium">{labelOf(FUND_CATEGORIES, m.category)}</span>
                  <div className="text-xs" style={{ color: C.muted }}>{m.performed_by_name} · {fmtDT(m.created_at)}{m.notes ? ` · ${m.notes}` : ""}</div></div>
                <Badge tone={m.direction === "in" ? "green" : "red"}>{m.direction === "in" ? "+" : "−"}{peso(m.amount)}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================ BILLS ============= */
function Bills() {
  const bills = useResource("/bills");
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ name: "", category: "Utilities", amount: "", due_date: "" });

  const addBill = () => act(async () => {
    if (!f.name || !f.amount) return;
    await api.post("/bills", { ...f, amount: +f.amount }); setF({ name: "", category: "Utilities", amount: "", due_date: "" }); setShowAdd(false); await bills.reload();
  });
  const togglePaid = (b) => act(async () => { await api.patch(`/bills/${b.id}/paid`, { paid: !b.is_paid }); await bills.reload(); });

  const month = phNow().getMonth();
  const data = bills.data || [];
  const monthPaid = data.filter((b) => b.is_paid && b.paid_at && new Date(b.paid_at).getMonth() === month).reduce((a, b) => a + Number(b.amount), 0);
  const unpaidTotal = data.filter((b) => !b.is_paid).reduce((a, b) => a + Number(b.amount), 0);

  return (
    <div className="space-y-3">
      {bills.error && <ErrorBox error={bills.error} onRetry={bills.reload} />}
      <div className="flex flex-wrap gap-3">
        <Card className="p-3" style={{ flex: 1 }}><Label>Unpaid</Label><div className="text-xl font-bold" style={{ color: C.red }}>{peso(unpaidTotal)}</div></Card>
        <Card className="p-3" style={{ flex: 1 }}><Label>Paid this month</Label><div className="text-xl font-bold">{peso(monthPaid)}</div></Card>
      </div>
      <div className="flex justify-between items-center">
        <div className="font-bold">Bills & expenses</div>
        <Btn kind="amber" onClick={() => setShowAdd(!showAdd)}><Plus size={14} className="inline mr-1" />Add bill</Btn>
      </div>
      {showAdd && (
        <Card className="p-3 space-y-2">
          <div><Label>Bill name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Meralco — electricity" /></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label>Category</Label>
              <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {["Utilities", "Rent", "Internet", "Supplier", "Salary", "Permits", "Other"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </div>
            <div><Label>Amount ₱</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div><Label>Due date</Label><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
          </div>
          <Btn onClick={addBill} className="w-full"><Check size={14} className="inline mr-1" />Save bill</Btn>
        </Card>
      )}
      {bills.loading ? <Loading /> : data.length === 0 ? (
        <Card><Empty text="Track rent, electricity, internet, supplier payments — so you always know the shop's true costs." /></Card>
      ) : (
        <div className="space-y-2">
          {data.map((b) => (
            <Card key={b.id} className="p-3 flex justify-between items-center" style={{ opacity: b.is_paid ? 0.65 : 1 }}>
              <div>
                <div className="font-medium text-sm">{b.name}</div>
                <div className="text-xs" style={{ color: C.muted }}>{b.category}{b.due_date ? ` · due ${String(b.due_date).slice(0, 10)}` : ""}{b.is_paid && b.paid_at ? ` · paid ${fmtDT(b.paid_at)}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">{peso(b.amount)}</span>
                <Btn kind={b.is_paid ? "ghost" : "primary"} onClick={() => togglePaid(b)}>{b.is_paid ? "Undo" : "Mark paid"}</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ BACKLOGS ========== */
function Backlogs({ setView }) {
  const services = useResource("/services");
  const pos = useResource("/purchase-orders");
  const bills = useResource("/bills");
  const loading = services.loading || pos.loading || bills.loading;

  const ageDays = (dt) => Math.floor((Date.now() - new Date(dt).getTime()) / 864e5);
  const items = [
    ...(services.data || []).filter((j) => j.status !== "released").map((j) => ({
      key: "j" + j.id, type: "Open repair", tone: "amber", since: j.received_at,
      title: j.device, sub: `${j.customer} · ${labelOf(JOB_STATUSES, j.status)}`, amount: Number(j.fee), go: "services",
    })),
    ...(pos.data || []).filter((p) => p.status !== "received" && p.status !== "cancelled").map((p) => ({
      key: "p" + p.id, type: "Pending order", tone: "neutral", since: p.created_at,
      title: `PO #${p.po_number} · ${p.supplier_name}`, sub: p.status.replace(/_/g, " "), amount: Number(p.total_cost || 0), go: "materials",
    })),
    ...(bills.data || []).filter((b) => !b.is_paid).map((b) => ({
      key: "b" + b.id, type: "Unpaid bill", tone: "red", since: b.created_at,
      title: b.name, sub: b.category + (b.due_date ? ` · due ${String(b.due_date).slice(0, 10)}` : ""), amount: Number(b.amount), go: "bills",
    })),
  ].sort((a, b) => ageDays(b.since) - ageDays(a.since));
  const total = items.reduce((a, i) => a + i.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="font-bold">Backlog — outstanding work</div>
        <Btn kind="ghost" onClick={() => act(() => downloadReport("backlogs"))}><Download size={13} className="inline mr-1" />Excel</Btn>
      </div>
      <Card className="p-3 flex justify-between items-center">
        <span className="text-sm" style={{ color: C.muted }}>{items.length} open item{items.length === 1 ? "" : "s"}</span>
        <span className="font-bold">{peso(total)}</span>
      </Card>
      {loading ? <Loading /> : items.length === 0 ? <Card><Empty text="Nothing outstanding — repairs released, orders received, bills paid. 🎉" /></Card> : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.key} className="p-3 flex justify-between items-center cursor-pointer" onClick={() => setView(it.go)}>
              <div>
                <div className="flex items-center gap-2"><Badge tone={it.tone}>{it.type}</Badge><span className="font-medium text-sm">{it.title}</span></div>
                <div className="text-xs mt-0.5" style={{ color: C.muted }}>{it.sub} · {ageDays(it.since)} day{ageDays(it.since) === 1 ? "" : "s"} old</div>
              </div>
              <span className="font-medium text-sm">{peso(it.amount)}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================ CASH CLOSING ====== */
function Closing() {
  const closing = useResource("/closings");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");

  const close = () => act(async () => {
    if (counted === "") return;
    await api.post("/closings", { counted_cash: +counted, notes });
    setCounted(""); setNotes(""); await closing.reload();
  });

  if (closing.loading) return <Loading />;
  if (closing.error) return <ErrorBox error={closing.error} onRetry={closing.reload} />;
  const d = closing.data;
  const expected = Number(d.expected_cash);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="font-bold text-sm mb-2 flex items-center gap-1.5"><Banknote size={15} /> Close today's cash — {d.today}</div>
        {d.closed_today ? <div className="text-sm py-3 text-center" style={{ color: C.green }}>✓ Today is already closed. Good discipline.</div> : (
          <div className="space-y-2">
            <div className="flex justify-between text-sm p-2 rounded-lg" style={{ background: "var(--c-subtle)" }}>
              <span style={{ color: C.muted }}>Expected cash (from today's cash sales)</span><span className="font-bold">{peso(expected)}</span>
            </div>
            <div><Label>Cash actually counted in the drawer ₱</Label><Input type="number" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0.00" /></div>
            {counted !== "" && (
              <div className="text-sm p-2 rounded-lg font-medium" style={+counted - expected === 0 ? { background: C.greenSoft, color: C.green } : { background: C.redSoft, color: C.red }}>
                Variance: {peso(+counted - expected)} {+counted - expected === 0 ? "— balanced ✓" : "— needs explanation"}
              </div>
            )}
            <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. ₱50 short — customer change error" /></div>
            <Btn kind="amber" className="w-full" onClick={close}>Close the day</Btn>
          </div>
        )}
      </Card>

      <Card className="p-3">
        <div className="font-bold text-sm mb-2">Closing history</div>
        {d.history.length === 0 ? <Empty text="Daily closings will appear here — your remote audit trail." /> : (
          <div className="space-y-1.5">
            {d.history.map((c) => {
              const v = Number(c.variance);
              return (
                <div key={c.id} className="flex justify-between items-center text-sm py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                  <div><span className="font-medium">{String(c.business_date).slice(0, 10)}</span>{c.notes && <span className="text-xs ml-2" style={{ color: C.muted }}>{c.notes}</span>}</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: C.muted }}>{peso(c.counted_cash)} / {peso(c.expected_cash)}</span>
                    <Badge tone={v === 0 ? "green" : "red"}>{v === 0 ? "Balanced" : (v > 0 ? "+" : "") + peso(v)}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================ PERFORMANCE ======= */
function Performance() {
  const { data, error, loading, reload } = useResource("/dashboard/performance");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { pl, staff } = data;
  const max = Math.max(...staff.map((r) => r.sales_total + r.service_income), 1);

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="font-bold text-sm mb-3">This month — shop result</div>
        <div className="space-y-1.5 text-sm">
          {[["Product sales", pl.revenue], ["Cost of goods", -pl.cogs], ["Service income", pl.service_income], ["Bills paid", -pl.bills_paid]].map(([l, v]) => (
            <div key={l} className="flex justify-between py-1" style={{ borderBottom: `1px solid ${C.line}` }}>
              <span style={{ color: C.muted }}>{l}</span>
              <span className="font-medium" style={{ color: v < 0 ? C.red : C.ink }}>{v < 0 ? "−" + peso(-v) : peso(v)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1.5">
            <span className="font-bold">Estimated profit</span>
            <span className="font-bold text-base" style={{ color: pl.profit >= 0 ? C.green : C.red }}>{peso(pl.profit)}</span>
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <div className="font-bold text-sm mb-3">Staff performance — this month</div>
        {staff.length === 0 ? <Empty text="Add staff to track who's producing." /> : (
          <div className="space-y-3">
            {staff.map((r) => (
              <div key={r.id}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{r.full_name} <span className="text-xs" style={{ color: C.muted }}>· {r.role}</span></span>
                  <span className="font-medium">{peso(r.sales_total + r.service_income)}</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: "var(--c-track)" }}>
                  <div className="h-2 rounded-full" style={{ width: `${((r.sales_total + r.service_income) / max) * 100}%`, background: C.amber }} />
                </div>
                <div className="text-xs mt-1" style={{ color: C.muted }}>{r.sales_count} sales · {r.jobs_done} repairs completed</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================ RATINGS =========== */
function Ratings() {
  const ratings = useResource("/ratings");
  const [stars, setStars] = useState(5);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");

  const add = () => act(async () => {
    await api.post("/ratings", { stars, customer_name: name || null, comment });
    setName(""); setComment(""); setStars(5); await ratings.reload();
  });

  const d = ratings.data;
  const dist = [5, 4, 3, 2, 1].map((s) => (d?.ratings || []).filter((r) => r.stars === s).length);
  const total = d?.count || 1;

  return (
    <div className="space-y-3">
      {ratings.error && <ErrorBox error={ratings.error} onRetry={ratings.reload} />}
      <Card className="p-3">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold">{d?.average || "—"}</div>
            <div className="text-xs" style={{ color: C.muted }}>{d?.count || 0} rating{d?.count === 1 ? "" : "s"}</div>
          </div>
          <div className="flex-1 space-y-1">
            {dist.map((count, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span style={{ width: 22, color: C.muted }}>{5 - i}★</span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: "var(--c-track)" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${(count / total) * 100}%`, background: C.amber }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <div className="font-bold text-sm">Log a customer rating</div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <button key={s} onClick={() => setStars(s)} className="text-2xl" style={{ color: s <= stars ? C.amber : C.line }}>★</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Customer name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <Btn kind="amber" onClick={add}>Save rating</Btn>
      </Card>

      <Card className="p-3">
        <div className="font-bold text-sm mb-2">Recent feedback</div>
        {!d || d.ratings.length === 0 ? <Empty text="Ask every repair customer for a quick rating at pickup — it keeps staff honest and service sharp." /> : (
          <div className="space-y-2">
            {d.ratings.slice(0, 20).map((r) => (
              <div key={r.id} className="py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.line}` }}>
                <div className="flex justify-between">
                  <span style={{ color: C.amber }}>{"★".repeat(r.stars)}<span style={{ color: C.line }}>{"★".repeat(5 - r.stars)}</span></span>
                  <span className="text-xs" style={{ color: C.muted }}>{fmtDT(r.created_at)}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: C.muted }}>{r.customer_name || "Anonymous"}{r.comment ? ` — "${r.comment}"` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================================================ REPORTS =========== */
function Reports() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState("");

  const REPORTS = [
    ["repair-logs", "Repair logs", "Every repair job with customer, device, technician, fee and status."],
    ["sales", "Sales", "All sales broken down by line item, with payment method and seller."],
    ["materials-orders", "Materials orders", "Purchase orders to suppliers with quantities and costs."],
    ["backlogs", "Backlogs", "Outstanding work: open repairs, pending orders, unpaid bills."],
    ["technician-productivity", "Technician productivity", "Per-staff repairs, turnaround, service income and sales."],
    ["fund-movement", "Fund movement", "Cash in/out with a running balance."],
  ];
  const dl = (type) => { setBusy(type); act(async () => { await downloadReport(type, { from, to }); }).finally(() => setBusy("")); };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="font-bold text-sm mb-2 flex items-center gap-1.5"><FileSpreadsheet size={15} /> Export to Excel</div>
        <div className="text-xs mb-2" style={{ color: C.muted }}>Optional date range (Manila dates). Leave blank for all-time. Reports cover the current branch.</div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </Card>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {REPORTS.map(([type, title, desc]) => (
          <Card key={type} className="p-3 flex flex-col justify-between">
            <div>
              <div className="font-bold text-sm">{title}</div>
              <div className="text-xs mt-1" style={{ color: C.muted }}>{desc}</div>
            </div>
            <Btn kind="amber" className="mt-3" onClick={() => dl(type)} disabled={busy === type}>
              <Download size={14} className="inline mr-1" />{busy === type ? "Preparing…" : "Download .xlsx"}
            </Btn>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================ STAFF ============= */
function Staff({ isManager, isOwner, branch, reloadBranch }) {
  const staff = useResource("/staff");
  const [f, setF] = useState({ full_name: "", username: "", password: "", role: "sales" });
  const [shopName, setShopName] = useState(branch?.name || "");
  const [nb, setNb] = useState({ name: "", city: "" });
  useEffect(() => { setShopName(branch?.name || ""); }, [branch?.name]);

  const addBranch = () => act(async () => {
    if (!nb.name.trim()) { window.alert("Branch name is required."); return; }
    await api.post("/branches", { name: nb.name.trim(), city: nb.city.trim() || null });
    setNb({ name: "", city: "" }); await reloadBranch();
    window.alert(`Branch "${nb.name.trim()}" created. Switch to it from the branch selector at the top.`);
  });

  const add = () => act(async () => {
    if (!f.full_name || !f.username || !f.password) { window.alert("Name, username and password are required."); return; }
    await api.post("/staff", f); setF({ full_name: "", username: "", password: "", role: "sales" }); await staff.reload();
  });
  const resetPw = (s) => {
    const pw = window.prompt(`New password for ${s.full_name}:`); if (!pw) return;
    act(async () => { await api.post(`/staff/${s.id}/password`, { password: pw }); window.alert("Password updated."); });
  };
  const deactivate = (s) => {
    if (!window.confirm(`Deactivate ${s.full_name}? Their past records stay intact.`)) return;
    act(async () => { await api.del(`/staff/${s.id}`); await staff.reload(); });
  };
  const saveShop = () => act(async () => { if (!branch) return; await api.patch(`/branches/${branch.id}`, { name: shopName }); await reloadBranch(); });

  return (
    <div className="space-y-3">
      {staff.error && <ErrorBox error={staff.error} onRetry={staff.reload} />}
      {isManager && (
        <Card className="p-3 space-y-2">
          <div className="font-bold text-sm">Shop / branch name</div>
          <div className="flex gap-2">
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Shop / branch name" />
            <Btn onClick={saveShop}>Save</Btn>
          </div>
        </Card>
      )}

      {isOwner && (
        <Card className="p-3 space-y-2">
          <div className="font-bold text-sm">Add branch / location</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Branch name" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
            <Input placeholder="City (optional)" value={nb.city} onChange={(e) => setNb({ ...nb, city: e.target.value })} />
          </div>
          <Btn kind="amber" onClick={addBranch}><Plus size={14} className="inline mr-1" />Add branch</Btn>
        </Card>
      )}

      {isManager && (
        <Card className="p-3 space-y-2">
          <div className="font-bold text-sm">Add staff login</div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Full name" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {["manager", "sales", "technician", "partner"].map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
            <Input placeholder="Password" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
          <Btn kind="amber" onClick={add}><Plus size={14} className="inline mr-1" />Add staff</Btn>
        </Card>
      )}

      <Card className="p-3">
        <div className="font-bold text-sm mb-2">Team{staff.data ? ` (${staff.data.filter((s) => s.is_active).length})` : ""}</div>
        {staff.loading ? <Loading /> : (
          <div className="space-y-1.5">
            {(staff.data || []).filter((s) => s.is_active).map((s) => (
              <div key={s.id} className="flex justify-between items-center text-sm py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
                <div><span className="font-medium">{s.full_name}</span>
                  <span className="text-xs ml-2" style={{ color: C.muted }}>{ROLE_LABELS[s.role] || s.role} · @{s.username}</span></div>
                {isManager && (
                  <div className="flex gap-1">
                    <Btn kind="ghost" onClick={() => resetPw(s)}>Reset password</Btn>
                    <button onClick={() => deactivate(s)}><Trash2 size={14} color={C.red} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
