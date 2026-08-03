import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

const channelLabels = {
  facebook: "Facebook",
  zalo: "Zalo",
  tiktok: "TikTok",
  shopee: "Shopee",
  website: "Website",
  lazada: "Lazada",
  unknown: "Chưa xác định"
};

const statusLabels = {
  pending_pickup: "Đang chờ lấy hàng",
  shipping: "Đang vận chuyển",
  delivered: "Đã giao",
  completed: "Hoàn thành",
  cancelled: "Đã Hủy",
  returned: "Trả Hàng"
};

const periodLabels = {
  day: "Theo ngày",
  week: "Theo tuần",
  month: "Theo tháng",
  quarter: "Theo quý",
  year: "Theo năm"
};

const filePeriodLabels = {
  day: "ngay",
  week: "tuan",
  month: "thang",
  quarter: "quy",
  year: "nam"
};

const currencyFormat = '#,##0 "đ";[Red](#,##0 "đ");-';
const teal = "0F766E";
const tealDark = "0A5D57";
const tealPale = "E5F3F1";
const bluePale = "EFF6FF";
const line = "D9E3E2";
const ink = "1F2D33";
const muted = "64748B";

const moneyText = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

const dateTimeText = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dateText = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

function rangeText(range) {
  const start = dateText.format(new Date(`${range.startDate}T00:00:00+07:00`));
  const end = dateText.format(new Date(`${range.endDate}T00:00:00+07:00`));
  return start === end ? `Ngày ${start}` : `Từ ${start} đến ${end}`;
}

function variantText(item) {
  return [
    item.size ? `Size ${item.size}` : "",
    item.color ? `Màu ${item.color}` : ""
  ].filter(Boolean).join(" - ");
}

function mainProductsText(order) {
  return order.items.map((item) => {
    const variant = variantText(item);
    return `${item.name} (${item.code}${variant ? `, ${variant}` : ""}) x ${item.quantity} ${item.unit}`;
  }).join("; ");
}

function addonProductsText(order) {
  return order.addons.map((item) => (
    `${item.name} (${item.code}) x ${item.quantity} ${item.unit}`
  )).join("; ");
}

function allProductsText(order) {
  const main = mainProductsText(order);
  const addons = addonProductsText(order);
  return addons ? `${main}\nKèm: ${addons}` : main;
}

function customerText(order) {
  return [order.customerName, order.customerPhone, order.customerAddress]
    .filter(Boolean)
    .join(" - ");
}

function applyHeaderStyle(row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
    cell.font = { bold: true, color: { argb: "FFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: tealDark } },
      left: { style: "thin", color: { argb: tealDark } },
      bottom: { style: "thin", color: { argb: tealDark } },
      right: { style: "thin", color: { argb: tealDark } }
    };
  });
}

function applyBodyBorders(row) {
  row.eachCell((cell) => {
    cell.border = {
      bottom: { style: "thin", color: { argb: line } }
    };
    cell.alignment = { vertical: "top", wrapText: true };
  });
}

function addOrderDetailSheet(workbook, report) {
  const sheet = workbook.addWorksheet("Đơn hàng", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 }
    }
  });
  sheet.properties.defaultRowHeight = 20;
  sheet.columns = [
    { header: "STT", key: "number", width: 7 },
    { header: "Thời gian", key: "createdAt", width: 19 },
    { header: "Mã đơn", key: "orderCode", width: 24 },
    { header: "Kênh bán", key: "channel", width: 14 },
    { header: "Trạng thái", key: "status", width: 21 },
    { header: "Khách hàng", key: "customer", width: 36 },
    { header: "Sản phẩm chính", key: "mainProducts", width: 48 },
    { header: "Sản phẩm đi kèm", key: "addons", width: 48 },
    { header: "Người xuất", key: "operator", width: 20 },
    { header: "Doanh thu", key: "revenue", width: 17 },
    { header: "Phí sàn", key: "platformFee", width: 15 },
    { header: "Phí vận chuyển", key: "shippingFee", width: 17 },
    { header: "Giá vốn", key: "cogs", width: 17 },
    { header: "Tổng chi phí", key: "totalCosts", width: 17 },
    { header: "Lợi nhuận", key: "profit", width: 17 }
  ];
  applyHeaderStyle(sheet.getRow(1));
  sheet.autoFilter = { from: "A1", to: "O1" };

  report.orders.forEach((order, index) => {
    const rowNumber = index + 2;
    const totalCosts = Number(order.cogs) + Number(order.sellingFee || 0);
    const row = sheet.addRow({
      number: index + 1,
      createdAt: new Date(order.createdAt),
      orderCode: order.orderCode,
      channel: channelLabels[order.channel] || order.channel,
      status: statusLabels[order.status] || order.status,
      customer: customerText(order) || "-",
      mainProducts: mainProductsText(order),
      addons: addonProductsText(order) || "-",
      operator: order.operatorName || "Dữ liệu cũ",
      revenue: Number(order.revenue),
      platformFee: Number(order.platformFee),
      shippingFee: Number(order.shippingFee),
      cogs: Number(order.cogs),
      totalCosts: { formula: `K${rowNumber}+L${rowNumber}+M${rowNumber}`, result: totalCosts },
      profit: { formula: `J${rowNumber}-N${rowNumber}`, result: Number(order.profit) }
    });
    row.height = Math.max(24, Math.min(72, 18 + Math.max(order.items.length, order.addons.length) * 12));
    applyBodyBorders(row);
    row.getCell(2).numFmt = "dd/mm/yyyy hh:mm";
    for (const column of [10, 11, 12, 13, 14, 15]) {
      row.getCell(column).numFmt = currencyFormat;
      row.getCell(column).alignment = { vertical: "top", horizontal: "right" };
    }
    row.getCell(15).font = { bold: true, color: { argb: Number(order.profit) < 0 ? "B91C1C" : tealDark } };
  });

  if (report.orders.length === 0) {
    sheet.mergeCells("A2:O2");
    const empty = sheet.getCell("A2");
    empty.value = "Không có đơn hàng trong kỳ báo cáo.";
    empty.alignment = { horizontal: "center", vertical: "middle" };
    empty.font = { italic: true, color: { argb: muted } };
    sheet.getRow(2).height = 30;
  }
  sheet.headerFooter.oddFooter = "TaHa Shoes - Báo cáo bán hàng | Trang &P / &N";
  return sheet;
}

function addSummarySheet(workbook, report) {
  const sheet = workbook.addWorksheet("Tổng quan", {
    views: [{ state: "frozen", ySplit: 9, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
    }
  });
  sheet.columns = [
    { width: 24 }, { width: 17 }, { width: 17 }, { width: 19 },
    { width: 18 }, { width: 18 }, { width: 18 }
  ];
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "BÁO CÁO BÁN HÀNG - TAHA SHOES";
  sheet.getCell("A1").font = { bold: true, size: 20, color: { argb: "FFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 38;

  sheet.mergeCells("A2:G2");
  sheet.getCell("A2").value = `${periodLabels[report.range.period]} - ${rangeText(report.range)}`;
  sheet.getCell("A2").font = { bold: true, size: 12, color: { argb: tealDark } };
  sheet.getCell("A2").alignment = { horizontal: "center" };
  sheet.mergeCells("A3:G3");
  sheet.getCell("A3").value = `Xuất lúc ${dateTimeText.format(new Date())}`;
  sheet.getCell("A3").font = { italic: true, size: 9, color: { argb: muted } };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  const labels = ["SỐ ĐƠN", "DOANH THU", "PHÍ SÀN", "PHÍ VẬN CHUYỂN", "GIÁ VỐN", "TỔNG CHI PHÍ", "LỢI NHUẬN"];
  sheet.getRow(5).values = labels;
  sheet.getRow(5).height = 24;
  sheet.getRow(5).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealPale } };
    cell.font = { bold: true, size: 9, color: { argb: tealDark } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  const lastDetailRow = Math.max(2, report.orders.length + 1);
  const totalCosts = Number(report.totals.cogs) + Number(report.totals.sellingFees);
  const values = [
    {
      formula: `COUNTIFS('Đơn hàng'!E2:E${lastDetailRow},"<>Trả Hàng",'Đơn hàng'!E2:E${lastDetailRow},"<>Đã Hủy")`,
      result: Number(report.totals.orders)
    },
    { formula: `SUM('Đơn hàng'!J2:J${lastDetailRow})`, result: Number(report.totals.revenue) },
    { formula: `SUM('Đơn hàng'!K2:K${lastDetailRow})`, result: Number(report.totals.platformFees) },
    { formula: `SUM('Đơn hàng'!L2:L${lastDetailRow})`, result: Number(report.totals.shippingFees) },
    { formula: `SUM('Đơn hàng'!M2:M${lastDetailRow})`, result: Number(report.totals.cogs) },
    { formula: `SUM('Đơn hàng'!N2:N${lastDetailRow})`, result: totalCosts },
    { formula: `SUM('Đơn hàng'!O2:O${lastDetailRow})`, result: Number(report.totals.profit) }
  ];
  sheet.getRow(6).values = values;
  sheet.getRow(6).height = 34;
  sheet.getRow(6).eachCell((cell, columnNumber) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: columnNumber === 7 ? bluePale : "FFFFFF" } };
    cell.font = { bold: true, size: 13, color: { argb: columnNumber === 7 ? "1D4ED8" : ink } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: line } },
      left: { style: "thin", color: { argb: line } },
      bottom: { style: "thin", color: { argb: line } },
      right: { style: "thin", color: { argb: line } }
    };
    if (columnNumber > 1) cell.numFmt = currencyFormat;
  });

  sheet.mergeCells("A8:G8");
  sheet.getCell("A8").value = "HIỆU QUẢ THEO KÊNH BÁN";
  sheet.getCell("A8").font = { bold: true, size: 11, color: { argb: tealDark } };
  sheet.getCell("A8").alignment = { vertical: "middle" };
  sheet.getRow(9).values = ["Kênh bán", "Số đơn", "SP chính", "Doanh thu", "Phí bán hàng", "Giá vốn", "Lợi nhuận"];
  applyHeaderStyle(sheet.getRow(9));
  report.channels.forEach((channel, index) => {
    const row = sheet.addRow([
      channelLabels[channel.channel] || channel.channel,
      Number(channel.orders),
      Number(channel.units),
      Number(channel.revenue),
      Number(channel.sellingFees),
      Number(channel.cogs),
      Number(channel.profit)
    ]);
    row.height = 22;
    applyBodyBorders(row);
    if (index % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F8FAF9" } };
      });
    }
    for (const column of [4, 5, 6, 7]) row.getCell(column).numFmt = currencyFormat;
  });
  const totalRow = sheet.addRow([
    "TỔNG TẤT CẢ KÊNH",
    Number(report.totals.orders),
    Number(report.totals.units),
    Number(report.totals.revenue),
    Number(report.totals.sellingFees),
    Number(report.totals.cogs),
    Number(report.totals.profit)
  ]);
  totalRow.height = 25;
  totalRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealPale } };
    cell.font = { bold: true, color: { argb: tealDark } };
    cell.border = { top: { style: "medium", color: { argb: teal } } };
  });
  for (const column of [4, 5, 6, 7]) totalRow.getCell(column).numFmt = currencyFormat;
  sheet.headerFooter.oddFooter = "TaHa Shoes - Báo cáo bán hàng | Trang &P / &N";
  return sheet;
}

export async function buildReportExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TaHa Shoes";
  workbook.company = "TaHa Shoes";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  addSummarySheet(workbook, report);
  addOrderDetailSheet(workbook, report);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function findFont(candidates) {
  return candidates.find((path) => existsSync(path));
}

function pdfFonts() {
  const regular = findFont([
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"
  ]);
  const bold = findFont([
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
  ]);
  if (!regular || !bold) throw new Error("Không tìm thấy font Unicode để xuất PDF.");
  return { regular, bold };
}

function addPdfPage(doc, report, continuation = false) {
  doc.addPage();
  const { width } = doc.page;
  doc.font("Bold").fontSize(9).fillColor("#0F766E").text("TAHA SHOES", 32, 20);
  doc.font("Regular").fontSize(7.5).fillColor("#64748B").text(
    `${periodLabels[report.range.period]} - ${rangeText(report.range)}`,
    300,
    21,
    { width: width - 332, align: "right" }
  );
  doc.moveTo(32, 35).lineTo(width - 32, 35).lineWidth(0.6).strokeColor("#D9E3E2").stroke();
  if (continuation) {
    doc.font("Bold").fontSize(12).fillColor("#1F2D33").text("Chi tiết đơn hàng (tiếp theo)", 32, 45);
    return 67;
  }
  return 45;
}

function drawPdfSummary(doc, report, y) {
  doc.font("Bold").fontSize(20).fillColor("#1F2D33").text("BÁO CÁO BÁN HÀNG", 32, y);
  doc.font("Regular").fontSize(9).fillColor("#64748B").text(
    `${periodLabels[report.range.period]} - ${rangeText(report.range)} | Xuất lúc ${dateTimeText.format(new Date())}`,
    32,
    y + 28
  );
  const items = [
    ["TỔNG SỐ ĐƠN", report.totals.orders.toLocaleString("vi-VN")],
    ["DOANH THU", moneyText.format(report.totals.revenue)],
    ["TỔNG CHI PHÍ", moneyText.format(report.totals.cogs + report.totals.sellingFees)],
    ["LỢI NHUẬN", moneyText.format(report.totals.profit)]
  ];
  const gap = 8;
  const width = (doc.page.width - 64 - gap * 3) / 4;
  items.forEach(([label, value], index) => {
    const x = 32 + index * (width + gap);
    doc.roundedRect(x, y + 52, width, 48, 6)
      .fillAndStroke(index === 3 ? "#EFF6FF" : "#F6FAF9", index === 3 ? "#93B4FA" : "#D9E3E2");
    doc.font("Bold").fontSize(7).fillColor(index === 3 ? "#1D4ED8" : "#64748B")
      .text(label, x + 9, y + 62, { width: width - 18 });
    doc.font("Bold").fontSize(11).fillColor(index === 3 ? "#1E3A8A" : "#1F2D33")
      .text(value, x + 9, y + 78, { width: width - 18 });
  });
  return y + 116;
}

function textHeight(doc, value, width, font = "Regular", fontSize = 7.5) {
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(String(value ?? ""), { width: width - 8, lineGap: 1 });
}

function drawPdfTableHeader(doc, columns, y) {
  let x = 32;
  const height = 24;
  columns.forEach((column) => {
    doc.rect(x, y, column.width, height).fillAndStroke("#0F766E", "#0A5D57");
    doc.font("Bold").fontSize(7).fillColor("#FFFFFF").text(
      column.label,
      x + 4,
      y + 7,
      { width: column.width - 8, align: column.align || "left" }
    );
    x += column.width;
  });
  return y + height;
}

function drawPdfTableRow(doc, columns, values, y, index) {
  const heights = columns.map((column, columnIndex) => textHeight(
    doc,
    values[columnIndex],
    column.width,
    column.bold ? "Bold" : "Regular",
    column.fontSize || 7.5
  ));
  const height = Math.max(23, Math.min(86, Math.max(...heights) + 10));
  let x = 32;
  columns.forEach((column, columnIndex) => {
    doc.rect(x, y, column.width, height)
      .fillAndStroke(index % 2 === 1 ? "#F8FAF9" : "#FFFFFF", "#D9E3E2");
    doc.font(column.bold ? "Bold" : "Regular")
      .fontSize(column.fontSize || 7.5)
      .fillColor(column.color || "#334155")
      .text(values[columnIndex], x + 4, y + 5, {
        width: column.width - 8,
        height: height - 8,
        align: column.align || "left",
        lineGap: 1,
        ellipsis: true
      });
    x += column.width;
  });
  return height;
}

function drawChannelTable(doc, report, y) {
  doc.font("Bold").fontSize(11).fillColor("#0A5D57").text("HIỆU QUẢ THEO KÊNH BÁN", 32, y);
  const columns = [
    { label: "Kênh bán", width: 115 },
    { label: "Số đơn", width: 58, align: "right" },
    { label: "SP chính", width: 62, align: "right" },
    { label: "Doanh thu", width: 135, align: "right" },
    { label: "Phí bán hàng", width: 130, align: "right" },
    { label: "Giá vốn", width: 130, align: "right" },
    { label: "Lợi nhuận", width: 135, align: "right" }
  ];
  let cursor = drawPdfTableHeader(doc, columns, y + 18);
  const rows = report.channels.map((channel) => [
    channelLabels[channel.channel] || channel.channel,
    channel.orders.toLocaleString("vi-VN"),
    channel.units.toLocaleString("vi-VN"),
    moneyText.format(channel.revenue),
    moneyText.format(channel.sellingFees),
    moneyText.format(channel.cogs),
    moneyText.format(channel.profit)
  ]);
  rows.push([
    "TỔNG TẤT CẢ KÊNH",
    report.totals.orders.toLocaleString("vi-VN"),
    report.totals.units.toLocaleString("vi-VN"),
    moneyText.format(report.totals.revenue),
    moneyText.format(report.totals.sellingFees),
    moneyText.format(report.totals.cogs),
    moneyText.format(report.totals.profit)
  ]);
  rows.forEach((values, index) => {
    const rowColumns = index === rows.length - 1
      ? columns.map((column) => ({ ...column, bold: true, color: "#0A5D57" }))
      : columns;
    cursor += drawPdfTableRow(doc, rowColumns, values, cursor, index);
  });
  return cursor;
}

function drawOrderTable(doc, report, y) {
  const columns = [
    { label: "STT", width: 28, align: "center" },
    { label: "Thời gian", width: 76 },
    { label: "Mã đơn", width: 92 },
    { label: "Kênh", width: 58 },
    { label: "Trạng thái", width: 82 },
    { label: "Sản phẩm", width: 192 },
    { label: "Doanh thu", width: 77, align: "right" },
    { label: "Chi phí", width: 77, align: "right" },
    { label: "Lợi nhuận", width: 77, align: "right" }
  ];
  doc.font("Bold").fontSize(11).fillColor("#0A5D57").text("CHI TIẾT ĐƠN HÀNG", 32, y);
  let cursor = drawPdfTableHeader(doc, columns, y + 18);
  const bottom = () => doc.page.height - 38;
  if (report.orders.length === 0) {
    doc.font("Regular").fontSize(9).fillColor("#64748B")
      .text("Không có đơn hàng trong kỳ báo cáo.", 32, cursor + 12);
    return cursor + 35;
  }
  report.orders.forEach((order, index) => {
    const values = [
      String(index + 1),
      dateTimeText.format(new Date(order.createdAt)),
      order.orderCode,
      channelLabels[order.channel] || order.channel,
      statusLabels[order.status] || order.status,
      allProductsText(order),
      moneyText.format(order.revenue),
      moneyText.format(order.cogs + order.sellingFee),
      moneyText.format(order.profit)
    ];
    const estimatedHeight = Math.max(...columns.map((column, columnIndex) => (
      textHeight(doc, values[columnIndex], column.width, "Regular", 7.5)
    ))) + 10;
    if (cursor + Math.max(23, Math.min(86, estimatedHeight)) > bottom()) {
      cursor = addPdfPage(doc, report, true);
      cursor = drawPdfTableHeader(doc, columns, cursor);
    }
    cursor += drawPdfTableRow(doc, columns, values, cursor, index);
  });
  return cursor;
}

export async function buildReportPdf(report) {
  const fonts = pdfFonts();
  const document = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: "A4",
    layout: "landscape",
    margins: { top: 32, right: 32, bottom: 32, left: 32 },
    info: {
      Title: `Báo cáo bán hàng - ${rangeText(report.range)}`,
      Author: "TaHa Shoes",
      Subject: periodLabels[report.range.period]
    }
  });
  document.registerFont("Regular", fonts.regular);
  document.registerFont("Bold", fonts.bold);
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  let y = addPdfPage(document, report);
  y = drawPdfSummary(document, report, y);
  y = drawChannelTable(document, report, y);
  if (y + 90 > document.page.height - 38) y = addPdfPage(document, report, true);
  else y += 18;
  drawOrderTable(document, report, y);

  const pages = document.bufferedPageRange();
  for (let pageIndex = pages.start; pageIndex < pages.start + pages.count; pageIndex += 1) {
    document.switchToPage(pageIndex);
    document.font("Regular").fontSize(7).fillColor("#64748B").text(
      `TaHa Shoes | Trang ${pageIndex - pages.start + 1}/${pages.count}`,
      32,
      document.page.height - 42,
      { width: document.page.width - 64, align: "center", lineBreak: false }
    );
  }
  document.end();
  return result;
}

export function reportExportFilename(range, extension) {
  const period = filePeriodLabels[range.period] || "bao-cao";
  return `bao-cao-ban-hang-${period}-${range.startDate}-den-${range.endDate}.${extension}`;
}
