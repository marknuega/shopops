/* ------------------------------------------------------------
   Print helpers — render a small HTML document into a hidden iframe
   and invoke the browser's print dialog. Works offline; no server.
   ------------------------------------------------------------ */
const peso = (n) => "₱" + Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDT = (ts) => (ts ? new Date(ts).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function printHTML(title, inner) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Courier New', ui-monospace, monospace; color: #15323B; margin: 0; padding: 12px; width: 300px; }
    .center { text-align: center; }
    .shop { font-size: 16px; font-weight: bold; }
    .muted { color: #5C6B70; font-size: 11px; }
    hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; }
    .row { display: flex; justify-content: space-between; font-size: 12px; }
    .tot { font-size: 14px; font-weight: bold; }
    .big { font-size: 22px; font-weight: bold; letter-spacing: 1px; }
    h2 { font-size: 13px; margin: 6px 0; }
    @media print { body { width: auto; } }
  </style></head><body>${inner}<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script></body></html>`;
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: 0, bottom: 0, width: 0, height: 0, border: 0 });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  iframe.contentWindow.focus();
  setTimeout(() => iframe.remove(), 60000);
}

export function printReceipt(sale, branch) {
  const items = (sale.items || []).map((i) => `
    <tr><td>${esc(i.name)}<br><span class="muted">${i.quantity} × ${peso(i.unit_price)}</span></td>
    <td class="r">${peso(i.unit_price * i.quantity)}</td></tr>`).join("");
  const subtotal = sale.subtotal != null ? sale.subtotal : Number(sale.total_amount) + Number(sale.discount || 0);
  const inner = `
    <div class="center">
      <div class="shop">${esc(branch?.name || "ShopOps")}</div>
      <div class="muted">${esc(branch?.city || "")}</div>
      <div class="muted">SALES RECEIPT</div>
    </div>
    <hr>
    <div class="row"><span>Receipt #</span><span>${esc(sale.sale_number ?? "—")}</span></div>
    <div class="row"><span>Date</span><span>${fmtDT(sale.created_at)}</span></div>
    <div class="row"><span>Cashier</span><span>${esc(sale.sold_by_name || "")}</span></div>
    <hr>
    <table>${items}</table>
    <hr>
    <div class="row"><span>Subtotal</span><span>${peso(subtotal)}</span></div>
    ${Number(sale.discount) ? `<div class="row"><span>Discount</span><span>− ${peso(sale.discount)}</span></div>` : ""}
    <div class="row tot"><span>TOTAL</span><span>${peso(sale.total_amount)}</span></div>
    <div class="row"><span>Payment</span><span>${esc((sale.payment_method || "").toUpperCase())}</span></div>
    ${sale.is_voided ? '<hr><div class="center tot">*** VOIDED ***</div>' : ""}
    <hr>
    <div class="center muted">Thank you! Please keep this receipt<br>for warranty &amp; returns.</div>`;
  printHTML(`Receipt ${sale.sale_number ?? ""}`, inner);
}

export function printClaim(job, branch) {
  const balance = Number(job.fee) - Number(job.amount_paid || 0);
  const inner = `
    <div class="center">
      <div class="shop">${esc(branch?.name || "ShopOps")}</div>
      <div class="muted">${esc(branch?.city || "")}</div>
      <div class="muted">REPAIR CLAIM STUB</div>
    </div>
    <hr>
    <div class="center big">CLAIM #${esc(job.claim_number ?? "—")}</div>
    <hr>
    <table>
      <tr><td class="muted">Customer</td><td class="r">${esc(job.customer)}</td></tr>
      <tr><td class="muted">Contact</td><td class="r">${esc(job.phone || "—")}</td></tr>
      <tr><td class="muted">Device</td><td class="r">${esc(job.device)}</td></tr>
      <tr><td class="muted">Issue</td><td class="r">${esc(job.issue || "—")}</td></tr>
      <tr><td class="muted">Received</td><td class="r">${fmtDT(job.received_at)}</td></tr>
      <tr><td class="muted">Status</td><td class="r">${esc((job.status || "").replace(/_/g, " "))}</td></tr>
    </table>
    <hr>
    <div class="row"><span>Service fee</span><span>${peso(job.fee)}</span></div>
    <div class="row"><span>Paid</span><span>${peso(job.amount_paid)}</span></div>
    <div class="row tot"><span>BALANCE</span><span>${peso(balance)}</span></div>
    <hr>
    <div class="center muted">Present this stub to claim your device.<br>Unclaimed items after 60 days may be<br>disposed of per shop policy.</div>`;
  printHTML(`Claim ${job.claim_number ?? ""}`, inner);
}
