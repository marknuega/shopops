import ExcelJS from "exceljs";

const INK = "FF15323B";
const AMBER = "FFE8930C";

// Build a styled single-sheet workbook from columns + rows.
// columns: [{ header, key, width, money?, number? }]
// opts: { sheetName, title, subtitle, totals: { key: value } }
export async function buildWorkbook(columns, rows, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ShopOps";
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheetName || "Report", {
    views: [{ state: "frozen", ySplit: opts.title ? 3 : 1 }],
  });

  let headerRowIdx = 1;

  if (opts.title) {
    ws.mergeCells(1, 1, 1, columns.length);
    const t = ws.getCell(1, 1);
    t.value = opts.title;
    t.font = { bold: true, size: 14, color: { argb: INK } };
    ws.mergeCells(2, 1, 2, columns.length);
    const s = ws.getCell(2, 1);
    s.value = opts.subtitle || `Generated ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`;
    s.font = { size: 9, color: { argb: "FF5C6B70" } };
    headerRowIdx = 3;
  }

  ws.columns = columns.map((c) => ({ key: c.key, width: c.width || 16 }));

  // header row
  const header = ws.getRow(headerRowIdx);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: c.money || c.number ? "right" : "left" };
  });
  header.height = 18;

  // data rows
  rows.forEach((r) => {
    const row = ws.addRow(r);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.money) {
        cell.numFmt = '"₱"#,##0.00';
        cell.alignment = { horizontal: "right" };
      } else if (c.number) {
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  // totals row
  if (opts.totals) {
    const totalRow = ws.addRow(opts.totals);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBEED7" } };
    });
    columns.forEach((c, i) => {
      if (c.money && opts.totals[c.key] != null) totalRow.getCell(i + 1).numFmt = '"₱"#,##0.00';
    });
  }

  return wb;
}

export function fmtDT(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}
