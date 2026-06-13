import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import { requireAuth } from "./auth.js";
import authRoutes from "./routes/auth.js";
import branchesRoutes from "./routes/branches.js";
import staffRoutes from "./routes/staff.js";
import productsRoutes from "./routes/products.js";
import inventoryRoutes from "./routes/inventory.js";
import salesRoutes from "./routes/sales.js";
import servicesRoutes from "./routes/services.js";
import purchaseOrdersRoutes from "./routes/purchaseOrders.js";
import suppliersRoutes from "./routes/suppliers.js";
import fundsRoutes from "./routes/funds.js";
import billsRoutes from "./routes/bills.js";
import closingsRoutes from "./routes/closings.js";
import ratingsRoutes from "./routes/ratings.js";
import dashboardRoutes from "./routes/dashboard.js";
import reportsRoutes from "./routes/reports.js";

const app = express();
const PORT = process.env.PORT || 4000;

// helmet, but allow the SPA + Google Fonts the frontend uses.
app.use(
  helmet({
    contentSecurityPolicy: false, // SPA loads Google Fonts + inline styles
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

// public
app.use("/api/auth", authRoutes);

// everything else requires a valid token
app.use("/api/branches", requireAuth, branchesRoutes);
app.use("/api/staff", requireAuth, staffRoutes);
app.use("/api/products", requireAuth, productsRoutes);
app.use("/api/inventory", requireAuth, inventoryRoutes);
app.use("/api/sales", requireAuth, salesRoutes);
app.use("/api/services", requireAuth, servicesRoutes);
app.use("/api/purchase-orders", requireAuth, purchaseOrdersRoutes);
app.use("/api/suppliers", requireAuth, suppliersRoutes);
app.use("/api/funds", requireAuth, fundsRoutes);
app.use("/api/bills", requireAuth, billsRoutes);
app.use("/api/closings", requireAuth, closingsRoutes);
app.use("/api/ratings", requireAuth, ratingsRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/reports", requireAuth, reportsRoutes);

// ---- serve the built frontend (production) ----
const distDir = path.join(__dirname, "..", "..", "dist");
app.use(express.static(distDir));
// SPA fallback: any non-API GET returns index.html
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) res.status(404).send("Frontend not built yet. Run `npm run build` in the project root.");
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ShopOps server listening on http://0.0.0.0:${PORT}`);
});
