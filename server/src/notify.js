/* ------------------------------------------------------------
   ShopOps daily alert notifier — low stock + bills due soon, via Telegram.

   Run on a schedule by the `shopops-notify` systemd timer (see deploy/setup.sh).
   - DB connection comes from server/.env (DATABASE_URL), via db.js.
   - Telegram + threshold config comes from /etc/shopops-notify.env, injected
     by systemd (EnvironmentFile). See deploy/README.md for setup.

   Manual test on the server:
     systemctl start shopops-notify && journalctl -u shopops-notify -n 30 --no-pager
   ------------------------------------------------------------ */
import { pool } from "./db.js";

const PH = "Asia/Manila";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const DUE_SOON_DAYS = parseInt(process.env.NOTIFY_DUE_SOON_DAYS || "3", 10);
// Repair-job thresholds (days):
const TAT_DAYS = parseInt(process.env.NOTIFY_TAT_DAYS || "3", 10);          // received but not started
const UNCLAIMED_DAYS = parseInt(process.env.NOTIFY_UNCLAIMED_DAYS || "7", 10); // ready but not picked up
const BACKLOG_DAYS = parseInt(process.env.NOTIFY_BACKLOG_DAYS || "30", 10);    // any open job this old
const ALWAYS = /^(1|true|yes|on)$/i.test(process.env.NOTIFY_ALWAYS || "");

const job = (r) =>
  `• #${r.claim_number} ${r.device} — ${r.customer} (${r.age_days}d) · ${r.branch} · 👤 ${r.tech || "unassigned"}`;

const peso = (n) => "₱" + Number(n).toLocaleString("en-PH");

async function main() {
  if (!TOKEN || !CHAT) {
    console.error("notify: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — edit /etc/shopops-notify.env. Skipping.");
    return;
  }

  // Low stock across all branches (view already filters quantity <= min_stock).
  const low = await pool.query(
    "SELECT branch, product, quantity, min_stock FROM v_low_stock ORDER BY branch, quantity"
  );

  // Unpaid bills that are overdue or due within DUE_SOON_DAYS days.
  const bills = await pool.query(
    `SELECT b.name,
            b.amount,
            to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
            br.name AS branch,
            (b.due_date < (now() AT TIME ZONE $2)::date) AS overdue
       FROM bills b
       JOIN branches br ON br.id = b.branch_id
      WHERE b.is_paid = false
        AND b.due_date IS NOT NULL
        AND b.due_date <= (now() AT TIME ZONE $2)::date + $1::int
      ORDER BY b.due_date`,
    [DUE_SOON_DAYS, PH]
  );

  // Repair jobs received but never started (still 'received') past the turnaround time.
  // Jobs older than the backlog threshold roll up into the backlog section instead.
  const notStarted = await pool.query(
    `SELECT j.claim_number, j.customer, j.device, br.name AS branch, u.full_name AS tech,
            EXTRACT(DAY FROM now() - j.received_at)::int AS age_days
       FROM service_jobs j
       JOIN branches br ON br.id = j.branch_id
       LEFT JOIN app_users u ON u.id = j.tech_id
      WHERE j.status = 'received'
        AND j.received_at <  now() - make_interval(days => $1::int)
        AND j.received_at >= now() - make_interval(days => $2::int)
      ORDER BY j.received_at`,
    [TAT_DAYS, BACKLOG_DAYS]
  );

  // Repaired and ready, but the customer hasn't claimed it. Age from ready_at
  // (fall back to received_at for legacy jobs marked ready before ready_at existed).
  const unclaimed = await pool.query(
    `SELECT j.claim_number, j.customer, j.device, br.name AS branch, u.full_name AS tech,
            EXTRACT(DAY FROM now() - COALESCE(j.ready_at, j.received_at))::int AS age_days
       FROM service_jobs j
       JOIN branches br ON br.id = j.branch_id
       LEFT JOIN app_users u ON u.id = j.tech_id
      WHERE j.status = 'ready_for_pickup'
        AND COALESCE(j.ready_at, j.received_at) <  now() - make_interval(days => $1::int)
        AND j.received_at >= now() - make_interval(days => $2::int)
      ORDER BY COALESCE(j.ready_at, j.received_at)`,
    [UNCLAIMED_DAYS, BACKLOG_DAYS]
  );

  // Aging backlog: any still-open job (not released) in the shop this long.
  const backlog = await pool.query(
    `SELECT j.claim_number, j.customer, j.device, j.status, br.name AS branch, u.full_name AS tech,
            EXTRACT(DAY FROM now() - j.received_at)::int AS age_days
       FROM service_jobs j
       JOIN branches br ON br.id = j.branch_id
       LEFT JOIN app_users u ON u.id = j.tech_id
      WHERE j.status <> 'released'
        AND j.received_at < now() - make_interval(days => $1::int)
      ORDER BY j.received_at`,
    [BACKLOG_DAYS]
  );

  const lines = [];
  if (low.rows.length) {
    lines.push(`⚠️ *Low stock* (${low.rows.length})`);
    for (const r of low.rows)
      lines.push(`• ${r.product} — ${r.quantity} left (min ${r.min_stock}) · ${r.branch}`);
  }
  if (bills.rows.length) {
    if (lines.length) lines.push("");
    lines.push(`🧾 *Bills due soon* (${bills.rows.length})`);
    for (const r of bills.rows) {
      const tag = r.overdue ? "OVERDUE" : `due ${r.due_date}`;
      lines.push(`• ${r.name} — ${peso(r.amount)} (${tag}) · ${r.branch}`);
    }
  }
  if (notStarted.rows.length) {
    if (lines.length) lines.push("");
    lines.push(`⏳ *Not started >${TAT_DAYS}d* (${notStarted.rows.length})`);
    for (const r of notStarted.rows) lines.push(job(r));
  }
  if (unclaimed.rows.length) {
    if (lines.length) lines.push("");
    lines.push(`📦 *Ready, unclaimed >${UNCLAIMED_DAYS}d* (${unclaimed.rows.length})`);
    for (const r of unclaimed.rows) lines.push(job(r));
  }
  if (backlog.rows.length) {
    if (lines.length) lines.push("");
    lines.push(`🐌 *Backlog — open >${BACKLOG_DAYS}d* (${backlog.rows.length})`);
    for (const r of backlog.rows) lines.push(job(r));
  }

  if (!lines.length) {
    if (!ALWAYS) {
      console.log("notify: nothing to report (no low stock, no bills due).");
      return;
    }
    lines.push("✅ All clear — no low stock, no bills due soon.");
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: PH });
  const text = `*ShopOps — ${today}*\n\n` + lines.join("\n");

  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    console.error("notify: Telegram API error", res.status, await res.text());
    process.exitCode = 1;
    return;
  }
  console.log(
    `notify: sent — ${low.rows.length} low-stock, ${bills.rows.length} bills, ` +
    `${notStarted.rows.length} not-started, ${unclaimed.rows.length} unclaimed, ${backlog.rows.length} backlog.`
  );
}

main()
  .catch((e) => {
    console.error("notify: failed —", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
