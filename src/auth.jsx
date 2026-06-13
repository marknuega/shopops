import React, { createContext, useContext, useEffect, useState } from "react";
import { Lock, LogIn } from "lucide-react";
import { api, setToken, getToken } from "./api.js";
import { MOCK } from "./config.js";

const C = {
  ink: "var(--c-ink)", inkSoft: "var(--c-ink-soft)", amber: "var(--c-amber)", amberSoft: "var(--c-amber-soft)",
  brand: "var(--c-brand)", bg: "var(--c-bg)", surface: "var(--c-surface)", line: "var(--c-line)",
  muted: "var(--c-muted)", red: "var(--c-red)", redSoft: "var(--c-red-soft)",
};

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

// In standalone (MOCK) mode there is no login: provide a default user and
// render the app directly. The real, login-gated provider is below.
export function AuthProvider({ children }) {
  return MOCK ? <NoAuthProvider>{children}</NoAuthProvider> : <RealAuthProvider>{children}</RealAuthProvider>;
}

function NoAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    api.get("/auth/me").then(({ user }) => setUser(user)).catch(() => {});
  }, []);
  return <AuthContext.Provider value={{ user, login: async () => {}, logout: () => {}, loading: false, noAuth: true }}>{children}</AuthContext.Provider>;
}

function RealAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // restore session
  useEffect(() => {
    (async () => {
      if (getToken()) {
        try {
          const { user } = await api.get("/auth/me");
          setUser(user);
        } catch {
          setToken(null);
        }
      }
      setLoading(false);
    })();
    const onUnauth = () => setUser(null);
    window.addEventListener("shopops-unauthorized", onUnauth);
    return () => window.removeEventListener("shopops-unauthorized", onUnauth);
  }, []);

  const login = async (username, password) => {
    const { token, user } = await api.post("/auth/login", { username, password });
    setToken(token);
    setUser(user);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {loading ? <Splash /> : user ? children : <LoginScreen onLogin={login} />}
    </AuthContext.Provider>
  );
}

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="text-sm" style={{ color: C.muted }}>Opening your shop…</div>
    </div>
  );
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await onLogin(username.trim(), password);
    } catch (e) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.brand, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap');`}</style>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl p-6" style={{ background: C.surface }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="p-2 rounded-lg" style={{ background: C.amberSoft }}><Lock size={18} color={C.amber} /></div>
          <div>
            <div className="font-bold text-lg" style={{ color: C.ink }}>ShopOps</div>
            <div className="text-xs" style={{ color: C.muted }}>Remote Manager — sign in</div>
          </div>
        </div>

        {err && <div className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: C.redSoft, color: C.red }}>{err}</div>}

        <div className="mt-4 space-y-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: C.muted }}>Username</div>
            <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: `1px solid ${C.line}`, background: "#FBFCFC", color: C.ink }} />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: C.muted }}>Password</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ border: `1px solid ${C.line}`, background: "#FBFCFC", color: C.ink }} />
          </div>
          <button type="submit" disabled={busy || !username || !password}
            className="w-full rounded-lg px-3 py-2.5 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: C.amber, color: "#fff" }}>
            <LogIn size={15} /> {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
