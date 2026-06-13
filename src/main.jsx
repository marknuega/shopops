import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./auth.jsx";
import ShopOps from "./ShopOps.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <ShopOps />
    </AuthProvider>
    <ThemeToggle />
  </React.StrictMode>
);
