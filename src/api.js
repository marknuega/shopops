/* ------------------------------------------------------------
   API client — talks to the ShopOps server.
   Attaches the bearer token (kept in localStorage) to every call.
   When config.MOCK is true, requests are served by the in-browser mock
   (no server, no login) instead of going over the network.
   ------------------------------------------------------------ */
import { MOCK } from "./config.js";
import { mockRequest } from "./mock/api.js";
import { mockDownloadReport } from "./mock/reports.js";

const TOKEN_KEY = "shopops-token";
const BRANCH_KEY = "shopops-active-branch";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Active branch — appended as ?branch= to every request so the owner can work
// across branches (staff are pinned server-side regardless).
let activeBranch = localStorage.getItem(BRANCH_KEY) || null;
export const getActiveBranch = () => activeBranch;
export const setActiveBranch = (id) => {
  activeBranch = id || null;
  if (id) localStorage.setItem(BRANCH_KEY, id); else localStorage.removeItem(BRANCH_KEY);
};

function withBranch(path) {
  if (!activeBranch || path.includes("branch=")) return path;
  return path + (path.includes("?") ? "&" : "?") + "branch=" + encodeURIComponent(activeBranch);
}

async function request(method, path, body) {
  const finalPath = withBranch(path);
  if (MOCK) {
    try {
      return await mockRequest(method, finalPath, body);
    } catch (e) {
      throw new ApiError(e.message || "Request failed", e.status || 500);
    }
  }
  return networkRequest(method, finalPath, body);
}

// Wipe and re-seed standalone demo data (mock mode only).
export async function resetDemo() {
  if (MOCK) return mockRequest("POST", "/dev/reset");
}

async function networkRequest(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    setToken(null);
    // let the app fall back to the login screen
    window.dispatchEvent(new Event("shopops-unauthorized"));
    throw new ApiError("Session expired — please log in again", 401);
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),
};

// Download an Excel report with auth, then trigger a browser save.
export async function downloadReport(type, params = {}) {
  const withBranchParams = activeBranch ? { ...params, branch: activeBranch } : params;
  if (MOCK) return mockDownloadReport(type, withBranchParams);
  const qs = new URLSearchParams(Object.entries(withBranchParams).filter(([, v]) => v)).toString();
  const token = getToken();
  const res = await fetch(`/api/reports/${type}.xlsx${qs ? "?" + qs : ""}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("Could not generate the report", res.status);
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `${type}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
