import React, { useState } from "react";
import { Sun, Moon } from "lucide-react";

/* ------------------------------------------------------------
   Floating light/dark theme toggle. Flips data-theme on <html>
   (see index.css for the palettes) and remembers the choice.
   Self-contained so it can be mounted anywhere without touching
   the rest of the app.
   ------------------------------------------------------------ */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") || "light");
  const dark = theme === "dark";

  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("shopops-theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode (night)"}
      aria-label="Toggle dark mode"
      style={{
        position: "fixed", right: 16, bottom: 16, zIndex: 50,
        width: 44, height: 44, borderRadius: 999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--c-brand)", color: "#fff",
        border: "1px solid var(--c-line)", boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        cursor: "pointer",
      }}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
