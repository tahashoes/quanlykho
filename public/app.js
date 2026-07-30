const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});
const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short"
});
const shortDate = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});
const viewTitles = {
  dashboard: "Tổng quan kho hàng",
  goods: "Nhập hàng",
  sales: "Xuất hàng",
  inventory: "Quản lý tồn kho",
  reports: "Báo cáo thống kê",
  managers: "Tài khoản quản lý"
};
const channelLabels = {
  facebook: "Facebook",
  zalo: "Zalo",
  tiktok: "TikTok",
  shopee: "Shopee",
  website: "Website",
  lazada: "Lazada",
  unknown: "Chưa xác định"
};

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const state = {
  currentUser: null,
  categories: [],
  products: [],
  transactions: [],
  dashboard: null,
  report: null,
  managers: [],
  reportPeriod: "day",
  reportAnchor: localDateValue(),
  productImage: null,
  editingManagerId: null
};
let saleOrderSequence = 0;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/auth/login") showLogin();
    throw new Error(payload.error || "Không thể kết nối tới máy chủ.");
  }
  return payload;
}

let toastTimer;
function toast(message, type = "success") {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = "toast"; }, 4200);
}

function text(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[char]);
}

function categoryById(id) {
  return state.categories.find((category) => category.id === Number(id));
}

function variantLabel(product) {
  return [
    product.size ? `Size ${product.size}` : "",
    product.color ? `Màu ${product.color}` : ""
  ].filter(Boolean).join(" · ") || "—";
}

function productOptionLabel(product) {
  const variant = variantLabel(product);
  return `${product.code}${variant === "—" ? "" : ` · ${variant}`} · còn ${product.stock} ${product.unit}`;
}

function categoryOptions(selectedId = "") {
  return `<option value="">Chọn danh mục</option>${state.categories.map((category) => (
    `<option value="${category.id}"${Number(selectedId) === category.id ? " selected" : ""}>${text(category.name)}</option>`
  )).join("")}`;
}

function discountLabel(item) {
  if (!item.discountValue) return "—";
  return item.discountType === "percent"
    ? `${Number(item.discountValue).toLocaleString("vi-VN")}%`
    : `${money.format(item.discountValue)} / SP`;
}

function metric(label, value, note, accent = false) {
  return `<article class="metric${accent ? " teal" : ""}"><span class="metric-label">${text(label)}</span><strong>${text(value)}</strong><small>${text(note)}</small></article>`;
}

const chartColors = ["#ee1b24", "#0f766e", "#f59e0b", "#2563eb", "#8b5cf6", "#db2777"];

function donutChart(items, options) {
  const rows = items.map((item) => ({
    item,
    value: Math.max(0, Number(options.value(item)) || 0)
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!rows.length || total === 0) {
    return `<p class="chart-empty">${text(options.emptyMessage)}</p>`;
  }
  const maximum = Math.max(...rows.map((row) => row.value));
  const minimum = Math.min(...rows.map((row) => row.value));
  let offset = 0;
  const segments = rows.map((row, index) => {
    if (row.value === 0) return "";
    const percentage = (row.value / total) * 100;
    const segment = `<circle class="donut-segment" cx="21" cy="21" r="15.9155" fill="none" stroke="${chartColors[index % chartColors.length]}" stroke-width="6.5" stroke-dasharray="${percentage.toFixed(3)} ${(100 - percentage).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}"><title>${text(options.label(row.item))}: ${text(options.formatValue(row.value))}</title></circle>`;
    offset += percentage;
    return segment;
  }).join("");
  const legend = rows.map((row, index) => {
    const isBest = row.value === maximum;
    const isLeast = minimum !== maximum && row.value === minimum;
    const stateLabel = isBest ? "Nhiều nhất" : isLeast ? "Ít nhất" : "";
    return `<div class="donut-legend-item">
      <span class="donut-swatch" style="--segment-color:${chartColors[index % chartColors.length]}"></span>
      <span class="donut-legend-name"><strong>${text(options.label(row.item))}</strong><small>${text(options.detail(row.item))}</small></span>
      <span class="donut-legend-value">${text(options.formatValue(row.value))}${stateLabel ? `<small>${stateLabel}</small>` : ""}</span>
    </div>`;
  }).join("");
  return `<div class="donut-layout" role="img" aria-label="${text(options.ariaLabel)}">
    <div class="donut-visual">
      <svg class="donut-svg" viewBox="0 0 42 42" aria-hidden="true">
        <circle class="donut-base" cx="21" cy="21" r="15.9155" fill="none" stroke-width="6.5"></circle>
        ${segments}
        <text class="donut-total" x="21" y="20.2" text-anchor="middle">${total.toLocaleString("vi-VN")}</text>
        <text class="donut-caption" x="21" y="24.5" text-anchor="middle">đơn hàng</text>
      </svg>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function columnChart(items, options) {
  const rows = items.map((item) => ({
    item,
    value: Math.max(0, Number(options.value(item)) || 0)
  }));
  const maximum = Math.max(0, ...rows.map((row) => row.value));
  if (!rows.length || maximum === 0) {
    return `<p class="chart-empty">${text(options.emptyMessage)}</p>`;
  }
  const columns = rows.map((row, index) => {
    const height = row.value === 0 ? 0 : Math.max(8, Math.round((row.value / maximum) * 100));
    const color = chartColors[index % chartColors.length];
    return `<div class="column-item">
      <span class="column-value">${text(options.formatValue(row.value))}</span>
      <div class="column-track" aria-hidden="true"><span class="column-bar" style="height:${height}%;background:${color}"></span></div>
      <strong title="${text(options.label(row.item))}">${text(options.label(row.item))}</strong>
      <small>${text(options.detail(row.item))}</small>
    </div>`;
  }).join("");
  return `<div class="column-chart" style="--column-count:${rows.length}" role="img" aria-label="${text(options.ariaLabel)}">${columns}</div>`;
}

function showLogin() {
  state.currentUser = null;
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  $("#login-form").elements.password.value = "";
  $("#login-error").classList.add("hidden");
  $("#login-error").textContent = "";
}

function showApp(user) {
  state.currentUser = user;
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#current-phone").textContent = user.name;
  $("#current-role").textContent = `${user.role === "admin" ? "Quản trị viên" : "Quản lý"} · ${user.phone}`;
  $(".user-avatar").textContent = user.role === "admin" ? "A" : "Q";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", user.role !== "admin");
  });
}

function renderDashboard() {
  const report = state.dashboard;
  if (!report) return;
  $("#dashboard-metrics").innerHTML = [
    metric("Doanh thu", money.format(report.revenue), "Từ toàn bộ hàng đã xuất", true),
    metric("Lợi nhuận", money.format(report.profit), "Doanh thu trừ giá vốn bán hàng"),
    metric("Giá trị tồn kho", money.format(report.inventoryValue), `${report.totalUnits} đơn vị trong kho`),
    metric("Sản phẩm", report.skuCount.toLocaleString("vi-VN"), `${report.lowStockCount} sản phẩm sắp hết`)
  ].join("");

  const rankings = report.rankings || {
    channels: [],
    soldProducts: [],
    inventoryProducts: []
  };
  $("#dashboard-channel-chart").innerHTML = donutChart(rankings.channels, {
    value: (item) => item.orders,
    label: (item) => channelLabels[item.channel] || item.channel,
    detail: (item) => `${item.units.toLocaleString("vi-VN")} sản phẩm`,
    formatValue: (value) => `${value.toLocaleString("vi-VN")} đơn`,
    emptyMessage: "Chưa có đơn hàng để xếp hạng.",
    ariaLabel: "Biểu đồ tròn tỷ trọng số đơn theo kênh bán toàn thời gian"
  });
  $("#dashboard-product-chart").innerHTML = columnChart(rankings.soldProducts, {
    value: (item) => item.units,
    label: (item) => item.name,
    detail: (item) => `${item.code} · ${item.orders.toLocaleString("vi-VN")} đơn`,
    formatValue: (value) => `${value.toLocaleString("vi-VN")} SP`,
    emptyMessage: "Chưa có sản phẩm bán ra.",
    ariaLabel: "Biểu đồ cột sản phẩm bán ra nhiều nhất toàn thời gian"
  });
  $("#dashboard-inventory-chart").innerHTML = columnChart(rankings.inventoryProducts, {
    value: (item) => item.stock,
    label: (item) => item.name,
    detail: (item) => item.code,
    formatValue: (value) => `${value.toLocaleString("vi-VN")} tồn`,
    emptyMessage: "Kho hiện chưa có sản phẩm.",
    ariaLabel: "Biểu đồ cột sản phẩm tồn kho nhiều nhất"
  });

  const lowProducts = state.products
    .filter((product) => product.stock <= 5)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5);
  $("#low-stock").innerHTML = lowProducts.length
    ? lowProducts.map((product) => `<div class="compact-row"><span class="row-icon">!</span><div class="row-copy"><strong>${text(product.name)}</strong><small>${text(product.code)}</small></div><div class="row-value">${product.stock}<small>còn lại</small></div></div>`).join("")
    : `<p class="empty">Kho hàng đang ở mức an toàn.</p>`;

  $("#recent-transactions").innerHTML = report.recent.length
    ? report.recent.map((item) => {
      const details = item.kind === "IN"
        ? "Nhập hàng"
        : `Xuất hàng · ${item.orderCode || "Chưa có mã đơn"} · ${channelLabels[item.channel] || "Chưa xác định"}`;
      return `<div class="compact-row"><span class="row-icon ${item.kind === "OUT" ? "out" : ""}">${item.kind === "IN" ? "+" : "−"}</span><div class="row-copy"><strong>${text(item.name)}</strong><small>${details} · ${dateTime.format(new Date(item.createdAt))}</small></div><div class="row-value">${item.kind === "IN" ? "+" : "−"}${item.quantity}<small>${money.format(item.total ?? item.quantity * item.unitPrice)}</small></div></div>`;
    }).join("")
    : `<p class="empty">Chưa có giao dịch nào.</p>`;
}

function renderProductOptions() {
  $("#product-codes").innerHTML = state.products
    .map((product) => `<option value="${text(product.code)}">${text(productOptionLabel(product))}</option>`)
    .join("");
  document.querySelectorAll("[data-sale-item]").forEach((item) => {
    const categorySelect = item.querySelector("[data-sale-field='categoryId']");
    const selectedCategory = categorySelect.value;
    categorySelect.innerHTML = categoryOptions(selectedCategory);
    updateSaleProductOptions(item);
    updateSaleItem(item);
  });
  updateSaleBuilderSummary();
}

function renderProducts(products = state.products) {
  $("#product-table").innerHTML = products.length
    ? products.map((product) => {
      const visual = product.image
        ? `<img class="product-thumb" src="${product.image}" alt="" />`
        : `<span class="product-placeholder">${text(product.name.slice(0, 1).toUpperCase())}</span>`;
      return `<tr><td><div class="product-cell">${visual}<span class="product-name">${text(product.name)}</span></div></td><td><span class="category-chip">${text(product.categoryName)}</span></td><td>${text(product.code)}</td><td>${text(variantLabel(product))}</td><td><span class="stock${product.stock <= 5 ? " low" : ""}">${product.stock}</span></td><td>${text(product.unit)}</td><td>${money.format(product.costPrice)}</td><td>${product.salePrice ? money.format(product.salePrice) : "—"}</td><td>${money.format(product.inventoryValue)}</td><td class="muted">${dateTime.format(new Date(product.updatedAt))}</td></tr>`;
    }).join("")
    : `<tr><td colspan="10" class="empty">Chưa tìm thấy sản phẩm.</td></tr>`;
}

function renderHistories() {
  const receiptRows = state.transactions.filter((item) => item.kind === "IN");
  const saleRows = state.transactions.filter((item) => item.kind === "OUT");

  $("#receipt-history-table").innerHTML = receiptRows.length
    ? receiptRows.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="operator-name">${text(item.operatorName || "Dữ liệu cũ")}</span></td><td><span class="category-chip">${text(item.categoryName)}</span></td><td>${text(item.code)}</td><td>${text(variantLabel(item))}</td><td>${item.quantity.toLocaleString("vi-VN")}</td><td>${text(item.unit)}</td><td>${money.format(item.unitPrice)}</td><td>${money.format(item.quantity * item.unitPrice)}</td></tr>`).join("")
    : `<tr><td colspan="9" class="empty">Chưa có lịch sử nhập hàng.</td></tr>`;

  $("#sale-history-table").innerHTML = saleRows.length
    ? saleRows.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="operator-name">${text(item.operatorName || "Dữ liệu cũ")}</span></td><td class="product-name">${text(item.orderCode || "—")}</td><td><span class="channel-chip">${text(channelLabels[item.channel] || "Chưa xác định")}</span></td><td><span class="category-chip">${text(item.categoryName)}</span></td><td>${text(item.code)}</td><td>${text(variantLabel(item))}</td><td>${item.quantity.toLocaleString("vi-VN")}</td><td>${text(item.unit)}</td><td>${money.format(item.unitPrice)}</td><td>${text(discountLabel(item))}</td><td>${money.format(item.total ?? item.quantity * item.unitPrice)}</td></tr>`).join("")
    : `<tr><td colspan="12" class="empty">Chưa có lịch sử xuất hàng.</td></tr>`;
}

function renderReport() {
  const report = state.report;
  if (!report) return;
  $("#report-range-label").textContent = report.range.startDate === report.range.endDate
    ? `Báo cáo ngày ${shortDate.format(new Date(`${report.range.startDate}T00:00:00`))}`
    : `Từ ${shortDate.format(new Date(`${report.range.startDate}T00:00:00`))} đến ${shortDate.format(new Date(`${report.range.endDate}T00:00:00`))}`;
  $("#report-metrics").innerHTML = [
    metric("Doanh thu", money.format(report.totals.revenue), "Tổng tất cả kênh", true),
    metric("Lợi nhuận", money.format(report.totals.profit), "Doanh thu trừ giá vốn"),
    metric("Số đơn hàng", report.totals.orders.toLocaleString("vi-VN"), "Đếm theo mã đơn hàng"),
    metric("Sản phẩm bán ra", report.totals.units.toLocaleString("vi-VN"), "Tổng số lượng trong các đơn")
  ].join("");
  const channelRanking = report.channels.filter((item) => item.channel !== "unknown").sort(
    (left, right) => right.orders - left.orders || right.units - left.units
  );
  $("#report-channel-chart").innerHTML = donutChart(channelRanking, {
    value: (item) => item.orders,
    label: (item) => channelLabels[item.channel] || item.channel,
    detail: (item) => `${item.units.toLocaleString("vi-VN")} sản phẩm · ${money.format(item.revenue)}`,
    formatValue: (value) => `${value.toLocaleString("vi-VN")} đơn`,
    emptyMessage: "Chưa có đơn hàng trong khoảng thời gian này.",
    ariaLabel: "Biểu đồ tròn tỷ trọng số đơn theo kênh bán trong kỳ báo cáo"
  });
  $("#report-product-chart").innerHTML = columnChart((report.products || []).slice(0, 5), {
    value: (item) => item.units,
    label: (item) => item.name,
    detail: (item) => `${item.code} · ${money.format(item.revenue)}`,
    formatValue: (value) => `${value.toLocaleString("vi-VN")} SP`,
    emptyMessage: "Chưa có sản phẩm bán ra trong khoảng thời gian này.",
    ariaLabel: "Biểu đồ cột sản phẩm bán nhiều nhất trong kỳ báo cáo"
  });
  const channelRows = report.channels.map((item) => `<tr><td><span class="channel-chip">${text(channelLabels[item.channel] || item.channel)}</span></td><td>${item.orders.toLocaleString("vi-VN")}</td><td>${item.units.toLocaleString("vi-VN")}</td><td>${money.format(item.revenue)}</td><td>${money.format(item.profit)}</td></tr>`).join("");
  $("#channel-table").innerHTML = `${channelRows}<tr class="channel-total"><td>TỔNG TẤT CẢ KÊNH</td><td>${report.totals.orders.toLocaleString("vi-VN")}</td><td>${report.totals.units.toLocaleString("vi-VN")}</td><td>${money.format(report.totals.revenue)}</td><td>${money.format(report.totals.profit)}</td></tr>`;
  $("#transaction-table").innerHTML = report.transactions.length
    ? report.transactions.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td class="product-name">${text(item.orderCode || "—")}</td><td><span class="channel-chip">${text(channelLabels[item.channel] || "Chưa xác định")}</span></td><td><span class="category-chip">${text(item.categoryName)}</span></td><td>${text(item.code)}</td><td>${text(variantLabel(item))}</td><td>${item.quantity}</td><td>${text(item.unit)}</td><td>${money.format(item.unitPrice)}</td><td>${text(discountLabel(item))}</td><td>${money.format(item.total ?? item.quantity * item.unitPrice)}</td></tr>`).join("")
    : `<tr><td colspan="11" class="empty">Không có đơn hàng trong khoảng thời gian này.</td></tr>`;
}

function renderManagers() {
  $("#manager-limit").textContent = `${state.managers.length}/5`;
  $("#manager-table").innerHTML = state.managers.length
    ? state.managers.map((manager) => `<tr><td class="product-name">${text(manager.name)}</td><td>${text(manager.phone)}</td><td><span class="role-chip">Quản lý</span></td><td class="muted">${dateTime.format(new Date(manager.createdAt))}</td><td class="muted">${dateTime.format(new Date(manager.updatedAt))}</td><td><div class="action-buttons"><button class="mini-button" data-manager-action="edit" data-id="${manager.id}">Sửa</button><button class="mini-button danger" data-manager-action="delete" data-id="${manager.id}">Xóa</button></div></td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">Chưa có tài khoản quản lý.</td></tr>`;
}

function renderCategories() {
  $("#category-count").textContent = `${state.categories.length} danh mục`;
  $("#category-list").innerHTML = state.categories.map((category) => (
    `<span class="category-chip category-chip-large">${text(category.name)}${category.requiresSize ? "<small>Có size</small>" : ""}</span>`
  )).join("");

  const newProductSelect = $("#new-product-form").elements.categoryId;
  const receiveSelect = $("#receive-form").elements.categoryId;
  const selectedNewProductCategory = newProductSelect.value;
  const selectedReceiveCategory = receiveSelect.value;
  newProductSelect.innerHTML = categoryOptions(selectedNewProductCategory);
  receiveSelect.innerHTML = categoryOptions(selectedReceiveCategory);
  updateNewProductCategoryRules();
  updateReceiveProductOptions();
}

function findProduct(code) {
  return state.products.find(
    (product) => product.code.toLowerCase() === String(code).trim().toLowerCase()
  );
}

function updateNewProductCategoryRules() {
  const form = $("#new-product-form");
  const category = categoryById(form.elements.categoryId.value);
  const sizeField = $("#new-product-size-field");
  const sizeInput = form.elements.size;
  const requiresSize = Boolean(category?.requiresSize);
  sizeField.classList.toggle("hidden", !requiresSize);
  sizeInput.required = requiresSize;
  if (!requiresSize) sizeInput.value = "";
  $("#new-product-price-note").textContent = category ? `(${category.priceNote})` : "";
}

function updateReceiveProductOptions() {
  const form = $("#receive-form");
  const categoryId = Number(form.elements.categoryId.value);
  const codeSelect = form.elements.code;
  const previousCode = codeSelect.value;
  const products = state.products.filter((product) => product.categoryId === categoryId);
  codeSelect.disabled = !categoryId;
  codeSelect.innerHTML = !categoryId
    ? `<option value="">Chọn danh mục trước</option>`
    : `<option value="">Chọn mã sản phẩm</option>${products.map((product) => (
      `<option value="${text(product.code)}"${product.code === previousCode ? " selected" : ""}>${text(productOptionLabel(product))}</option>`
    )).join("")}`;
  const category = categoryById(categoryId);
  $("#receive-price-note").textContent = category ? `(${category.priceNote})` : "";
  fillProductFields(form);
}

function fillProductFields(form) {
  const product = findProduct(form.elements.code.value);
  form.elements.name.value = product ? product.name : "";
  if (product && form.elements.salePrice && !form.elements.salePrice.value) {
    form.elements.salePrice.value = product.salePrice;
  }
  const preview = $("#receive-product-preview");
  if (!preview) return;
  if (!product) {
    preview.classList.add("hidden");
    preview.innerHTML = "";
    return;
  }
  const visual = product.image
    ? `<img src="${product.image}" alt="" />`
    : `<span class="product-placeholder">${text(product.name.slice(0, 1).toUpperCase())}</span>`;
  preview.innerHTML = `<span class="selected-product-visual">${visual}</span><span><strong>${text(product.name)}</strong><small>${text(product.categoryName)} · ${text(variantLabel(product))} · tồn ${product.stock.toLocaleString("vi-VN")} ${text(product.unit)}</small></span>`;
  preview.classList.remove("hidden");
}

function generateSaleOrderCode() {
  const date = new Date();
  const datePart = localDateValue(date).replaceAll("-", "");
  const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join("");
  saleOrderSequence = (saleOrderSequence + 1) % 100;
  return `DH-${datePart}-${timePart}${String(saleOrderSequence).padStart(2, "0")}`;
}

function saleItemTemplate() {
  return `<div class="sale-item-row" data-sale-item>
    <div class="sale-item-main">
      <label>Danh mục <span class="required-star">*</span>
        <select data-sale-field="categoryId">${categoryOptions()}</select>
      </label>
      <label class="sale-product-code">Mã sản phẩm <span class="required-star">*</span>
        <select data-sale-field="code" disabled><option value="">Chọn danh mục trước</option></select>
      </label>
      <div class="sale-product-preview" data-sale-preview>
        <span class="sale-preview-placeholder">?</span>
        <span><strong>Chưa chọn sản phẩm</strong><small>Chọn danh mục rồi chọn mã hàng</small></span>
      </div>
      <label>Số lượng <span class="required-star">*</span>
        <input data-sale-field="quantity" type="number" min="1" step="1" value="1" />
      </label>
      <label>Giá bán / SP <span class="required-star">*</span>
        <input data-sale-field="salePrice" type="number" min="0" step="1000" placeholder="0" />
      </label>
      <label>Loại giảm giá
        <select data-sale-field="discountType">
          <option value="">Không giảm</option>
          <option value="percent">Phần trăm (%)</option>
          <option value="amount">Số tiền / SP</option>
        </select>
      </label>
      <label>Giá trị giảm
        <input data-sale-field="discountValue" type="number" min="0" step="1000" value="0" disabled />
      </label>
      <div class="sale-line-total"><span>Thành tiền</span><strong data-sale-total>${money.format(0)}</strong></div>
      <button class="sale-remove-button" type="button" data-sale-action="remove-item" aria-label="Xóa sản phẩm" title="Xóa sản phẩm">×</button>
    </div>
  </div>`;
}

function saleOrderTemplate(orderCode = generateSaleOrderCode()) {
  return `<section class="sale-order-card" data-sale-order>
    <div class="sale-order-header">
      <div class="sale-order-title"><span class="sale-order-number" data-sale-order-number>Đơn hàng</span><small>Mỗi mã đơn có thể chứa nhiều sản phẩm</small></div>
      <label class="sale-order-code">Mã đơn hàng <span class="required-star">*</span>
        <span class="input-with-action">
          <input data-sale-field="orderCode" value="${text(orderCode)}" maxlength="64" placeholder="VD: DH-001" />
          <button type="button" class="inline-button" data-sale-action="generate-order">Tạo mã</button>
        </span>
      </label>
      <button class="sale-remove-order" type="button" data-sale-action="remove-order">Xóa đơn</button>
    </div>
    <div class="sale-order-items">${saleItemTemplate()}</div>
    <button class="sale-add-item" type="button" data-sale-action="add-item">+ Thêm sản phẩm vào đơn</button>
  </section>`;
}

function updateSaleProductOptions(item) {
  const categoryId = Number(item.querySelector("[data-sale-field='categoryId']").value);
  const codeSelect = item.querySelector("[data-sale-field='code']");
  const previousCode = codeSelect.value;
  const products = state.products.filter((product) => product.categoryId === categoryId);
  codeSelect.innerHTML = !categoryId
    ? `<option value="">Chọn danh mục trước</option>`
    : `<option value="">Chọn mã sản phẩm</option>${products.map((product) => (
      `<option value="${text(product.code)}"${product.code === previousCode ? " selected" : ""}>${text(productOptionLabel(product))}</option>`
    )).join("")}`;
  codeSelect.disabled = !categoryId || !$("#sale-form").elements.channel.value;
}

function updateSaleBuilderSummary() {
  const orders = [...document.querySelectorAll("[data-sale-order]")];
  const channelReady = Boolean($("#sale-form").elements.channel.value);
  $("#sale-orders").classList.toggle("locked", !channelReady);
  $("#sale-form [data-sale-action='add-order']").disabled = !channelReady;
  orders.forEach((order, index) => {
    order.querySelector("[data-sale-order-number]").textContent = `Đơn hàng ${index + 1}`;
    order.querySelector("[data-sale-field='orderCode']").disabled = !channelReady;
    order.querySelector("[data-sale-action='generate-order']").disabled = !channelReady;
    order.querySelector("[data-sale-action='add-item']").disabled = !channelReady;
    order.querySelector("[data-sale-action='remove-order']").disabled =
      !channelReady || orders.length === 1;
    const items = [...order.querySelectorAll("[data-sale-item]")];
    items.forEach((item) => {
      const categoryReady = Boolean(item.querySelector("[data-sale-field='categoryId']").value);
      const productReady = Boolean(item.querySelector("[data-sale-field='code']").value);
      item.querySelectorAll("input, select").forEach((field) => {
        const isDiscountValue = field.dataset.saleField === "discountValue";
        const isProductCode = field.dataset.saleField === "code";
        const isCategory = field.dataset.saleField === "categoryId";
        const discountType = item.querySelector("[data-sale-field='discountType']").value;
        field.disabled = !channelReady ||
          (isProductCode && !categoryReady) ||
          (!isCategory && !isProductCode && !productReady) ||
          (isDiscountValue && !discountType);
      });
      item.querySelector("[data-sale-action='remove-item']").disabled =
        !channelReady || items.length === 1;
    });
  });
  const itemCount = document.querySelectorAll("[data-sale-item]").length;
  $("#sale-batch-summary").textContent =
    `${orders.length} đơn hàng · ${itemCount} dòng sản phẩm`;
}

function updateSaleItem(item, prefillPrice = false) {
  const codeInput = item.querySelector("[data-sale-field='code']");
  const priceInput = item.querySelector("[data-sale-field='salePrice']");
  const quantityInput = item.querySelector("[data-sale-field='quantity']");
  const discountTypeInput = item.querySelector("[data-sale-field='discountType']");
  const discountValueInput = item.querySelector("[data-sale-field='discountValue']");
  const product = findProduct(codeInput.value);
  const preview = item.querySelector("[data-sale-preview]");

  if (product) {
    if (prefillPrice) priceInput.value = product.salePrice;
    const visual = product.image
      ? `<img src="${product.image}" alt="" />`
      : `<span class="sale-preview-placeholder">${text(product.name.slice(0, 1).toUpperCase())}</span>`;
    preview.innerHTML = `${visual}<span><strong>${text(product.name)}</strong><small>${text(product.code)} · ${text(variantLabel(product))} · còn ${product.stock.toLocaleString("vi-VN")} ${text(product.unit)}</small></span>`;
    preview.classList.add("found");
  } else {
    preview.innerHTML = `<span class="sale-preview-placeholder">?</span><span><strong>Chưa chọn sản phẩm</strong><small>Chọn danh mục rồi chọn mã hàng</small></span>`;
    preview.classList.remove("found");
  }

  const hasDiscount = Boolean(discountTypeInput.value);
  discountValueInput.disabled = !hasDiscount;
  if (!hasDiscount) discountValueInput.value = 0;
  discountValueInput.step = discountTypeInput.value === "percent" ? "0.01" : "1000";
  discountValueInput.max = discountTypeInput.value === "percent"
    ? "100"
    : String(Math.max(0, Number(priceInput.value) || 0));

  const quantity = Math.max(0, Number(quantityInput.value) || 0);
  const price = Math.max(0, Number(priceInput.value) || 0);
  const discountValue = Math.max(0, Number(discountValueInput.value) || 0);
  const gross = quantity * price;
  const discount = discountTypeInput.value === "percent"
    ? gross * Math.min(100, discountValue) / 100
    : discountTypeInput.value === "amount"
      ? quantity * Math.min(price, discountValue)
      : 0;
  item.querySelector("[data-sale-total]").textContent = money.format(Math.max(0, gross - discount));
}

function resetSaleBuilder() {
  const form = $("#sale-form");
  form.reset();
  $("#sale-orders").innerHTML = saleOrderTemplate();
  $("#sale-form-error").textContent = "";
  $("#sale-form-error").classList.add("hidden");
  updateSaleBuilderSummary();
}

function collectSalesPayload() {
  const form = $("#sale-form");
  const channel = form.elements.channel.value;
  if (!channel) throw new Error("Vui lòng chọn kênh bán hàng trước.");

  const seenOrderCodes = new Set();
  const stockNeeded = new Map();
  const orders = [...form.querySelectorAll("[data-sale-order]")].map((order, orderIndex) => {
    const orderCodeInput = order.querySelector("[data-sale-field='orderCode']");
    const orderCode = orderCodeInput.value.trim().toUpperCase();
    if (!orderCode) throw new Error(`Vui lòng nhập mã cho đơn hàng ${orderIndex + 1}.`);
    if (!/^[A-Z0-9._/-]+$/.test(orderCode) || orderCode.length > 64) {
      throw new Error(`Mã đơn ${orderCode} không đúng định dạng.`);
    }
    if (seenOrderCodes.has(orderCode)) {
      throw new Error(`Mã đơn ${orderCode} đang bị nhập trùng.`);
    }
    seenOrderCodes.add(orderCode);

    const seenProductCodes = new Set();
    const items = [...order.querySelectorAll("[data-sale-item]")].map((item, itemIndex) => {
      const categoryId = Number(item.querySelector("[data-sale-field='categoryId']").value);
      const category = categoryById(categoryId);
      if (!category) {
        throw new Error(`Vui lòng chọn danh mục ở dòng ${itemIndex + 1} của đơn ${orderCode}.`);
      }
      const code = item.querySelector("[data-sale-field='code']").value.trim().toUpperCase();
      const product = findProduct(code);
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm ở dòng ${itemIndex + 1} của đơn ${orderCode}.`);
      }
      if (seenProductCodes.has(product.code)) {
        throw new Error(`Sản phẩm ${product.code} bị lặp trong đơn ${orderCode}.`);
      }
      if (product.categoryId !== categoryId) {
        throw new Error(`Sản phẩm ${product.code} không thuộc danh mục ${category.name}.`);
      }
      seenProductCodes.add(product.code);

      const quantity = Number(item.querySelector("[data-sale-field='quantity']").value);
      const salePrice = Number(item.querySelector("[data-sale-field='salePrice']").value);
      const discountType = item.querySelector("[data-sale-field='discountType']").value || null;
      const discountValue = discountType
        ? Number(item.querySelector("[data-sale-field='discountValue']").value)
        : 0;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Số lượng của ${product.code} phải là số nguyên lớn hơn 0.`);
      }
      if (!Number.isFinite(salePrice) || salePrice < 0) {
        throw new Error(`Giá bán của ${product.code} không hợp lệ.`);
      }
      if (!Number.isFinite(discountValue) || discountValue < 0) {
        throw new Error(`Giá trị giảm của ${product.code} không hợp lệ.`);
      }
      if (discountType === "percent" && discountValue > 100) {
        throw new Error(`Giảm giá của ${product.code} không được vượt quá 100%.`);
      }
      if (discountType === "amount" && discountValue > salePrice) {
        throw new Error(`Tiền giảm mỗi sản phẩm ${product.code} không được lớn hơn giá bán.`);
      }
      stockNeeded.set(product.code, (stockNeeded.get(product.code) || 0) + quantity);
      return {
        categoryId,
        code: product.code,
        quantity,
        salePrice,
        discountType,
        discountValue
      };
    });
    return { orderCode, items };
  });

  for (const [code, quantity] of stockNeeded) {
    const product = findProduct(code);
    if (quantity > product.stock) {
      throw new Error(`Sản phẩm ${code} cần ${quantity}, nhưng trong kho chỉ còn ${product.stock}.`);
    }
  }
  return { channel, orders };
}

function formData(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  delete values.imageFile;
  return values;
}

async function refreshCore() {
  const requests = [
    api("/api/dashboard"),
    api("/api/categories"),
    api("/api/products"),
    api("/api/transactions")
  ];
  if (state.currentUser?.role === "admin") requests.push(api("/api/managers"));
  const [dashboard, categories, products, transactions, managers = []] = await Promise.all(requests);
  state.dashboard = dashboard;
  state.categories = categories;
  state.products = products;
  state.transactions = transactions;
  state.managers = managers;
  renderDashboard();
  renderCategories();
  renderProductOptions();
  renderProducts();
  renderHistories();
  if (state.currentUser?.role === "admin") renderManagers();
}

async function refreshReport() {
  const query = new URLSearchParams({
    period: state.reportPeriod,
    anchor: state.reportAnchor
  });
  state.report = await api(`/api/reports?${query}`);
  renderReport();
}

async function refreshAll() {
  try {
    await Promise.all([refreshCore(), refreshReport()]);
  } catch (error) {
    toast(error.message, "error");
  }
}

function showView(view) {
  if (view === "managers" && state.currentUser?.role !== "admin") view = "dashboard";
  document.querySelectorAll(".view").forEach((element) => {
    element.classList.toggle("active", element.id === `${view}-view`);
  });
  document.querySelectorAll(".nav-link").forEach((element) => {
    element.classList.toggle("active", element.dataset.view === view);
  });
  $("#page-title").textContent = viewTitles[view];
  window.location.hash = view;
  if (view === "reports" && state.currentUser) {
    refreshReport().catch((error) => toast(error.message, "error"));
  }
}

async function submitForm(form, endpoint, message, method = "POST", extraBody = {}) {
  const button = form.querySelector("button[type=submit]");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Đang lưu...";
  try {
    await api(endpoint, {
      method,
      body: JSON.stringify({ ...formData(form), ...extraBody })
    });
    form.reset();
    await refreshAll();
    toast(message);
    return true;
  } catch (error) {
    toast(error.message, "error");
    return false;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return reject(new Error("Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP."));
    }
    if (file.size > 8_000_000) {
      return reject(new Error("Ảnh gốc không được vượt quá 8 MB."));
    }
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const maxSide = 720;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Không thể đọc tệp ảnh này."));
    };
    image.src = objectUrl;
  });
}

function clearProductImage() {
  state.productImage = null;
  $("#product-image-input").value = "";
  $("#image-preview").classList.add("hidden");
  $("#image-preview img").removeAttribute("src");
}

function resetManagerForm() {
  state.editingManagerId = null;
  const form = $("#manager-form");
  form.reset();
  form.elements.password.required = true;
  $("#manager-form-title").textContent = "Thêm tài khoản quản lý";
  $("#manager-password-note").textContent = "(tối thiểu 6 ký tự, có ký tự đặc biệt)";
  $("#manager-password-star").classList.remove("hidden");
  $("#manager-form-error").textContent = "";
  $("#manager-form-error").classList.add("hidden");
  form.querySelector("button[type=submit]").textContent = "Thêm quản lý";
  $("#cancel-manager-edit").classList.add("hidden");
}

function startManagerEdit(id) {
  const manager = state.managers.find((item) => item.id === id);
  if (!manager) return;
  state.editingManagerId = id;
  const form = $("#manager-form");
  form.elements.name.value = manager.name;
  form.elements.phone.value = manager.phone;
  form.elements.password.value = "";
  form.elements.password.required = false;
  $("#manager-form-title").textContent = "Sửa tài khoản quản lý";
  $("#manager-password-note").textContent = "(để trống nếu giữ mật khẩu cũ)";
  $("#manager-password-star").classList.add("hidden");
  $("#manager-form-error").textContent = "";
  $("#manager-form-error").classList.add("hidden");
  form.querySelector("button[type=submit]").textContent = "Lưu thay đổi";
  $("#cancel-manager-edit").classList.remove("hidden");
  form.elements.phone.focus();
}

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.go));
});

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.classList.toggle("active", !showing);
    button.setAttribute("aria-label", showing ? "Hiện mật khẩu" : "Ẩn mật khẩu");
    button.title = showing ? "Hiện mật khẩu" : "Ẩn mật khẩu";
  });
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $("#login-error");
  const phone = String(form.elements.phone.value).replace(/[\s.-]/g, "");
  const password = form.elements.password.value;
  errorElement.classList.add("hidden");
  errorElement.textContent = "";
  if (!/^\+?\d{8,15}$/.test(phone)) {
    errorElement.textContent = "Số điện thoại phải có từ 8 đến 15 chữ số.";
    errorElement.classList.remove("hidden");
    form.elements.phone.focus();
    return;
  }
  if (password.length < 6) {
    errorElement.textContent = "Mật khẩu phải có ít nhất 6 ký tự.";
    errorElement.classList.remove("hidden");
    form.elements.password.focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  button.textContent = "Đang đăng nhập...";
  try {
    const user = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(formData(form))
    });
    showApp(user);
    const requestedView = Object.prototype.hasOwnProperty.call(viewTitles, location.hash.slice(1))
      ? location.hash.slice(1)
      : "dashboard";
    showView(requestedView);
    await refreshAll();
    form.reset();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Đăng nhập";
  }
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  showLogin();
});

const newProductForm = $("#new-product-form");
newProductForm.elements.categoryId.addEventListener("change", updateNewProductCategoryRules);
newProductForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const saved = await submitForm(
    newProductForm,
    "/api/products",
    "Đã thêm hàng hóa vào kho.",
    "POST",
    { image: state.productImage }
  );
  if (saved) clearProductImage();
});

$("#product-image-input").addEventListener("change", async (event) => {
  try {
    state.productImage = await compressImage(event.target.files[0]);
    if (state.productImage) {
      $("#image-preview img").src = state.productImage;
      $("#image-preview").classList.remove("hidden");
    }
  } catch (error) {
    clearProductImage();
    toast(error.message, "error");
  }
});
$("#remove-image").addEventListener("click", clearProductImage);

const categoryForm = $("#category-form");
categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitForm(
    categoryForm,
    "/api/categories",
    "Đã thêm danh mục hàng hóa mới.",
    "POST",
    { requiresSize: categoryForm.elements.requiresSize.checked }
  );
});

const receiveForm = $("#receive-form");
receiveForm.elements.categoryId.addEventListener("change", updateReceiveProductOptions);
receiveForm.elements.code.addEventListener("change", () => fillProductFields(receiveForm));
receiveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(receiveForm, "/api/receipts", "Đã nhập thêm hàng và cập nhật tồn kho.");
});

const saleForm = $("#sale-form");
resetSaleBuilder();
saleForm.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sale-action]");
  if (!button) return;
  const action = button.dataset.saleAction;
  const order = button.closest("[data-sale-order]");
  if (action === "add-order") {
    $("#sale-orders").insertAdjacentHTML("beforeend", saleOrderTemplate());
  } else if (action === "generate-order") {
    order.querySelector("[data-sale-field='orderCode']").value = generateSaleOrderCode();
  } else if (action === "remove-order") {
    if (saleForm.querySelectorAll("[data-sale-order]").length > 1) order.remove();
  } else if (action === "add-item") {
    order.querySelector(".sale-order-items").insertAdjacentHTML("beforeend", saleItemTemplate());
  } else if (action === "remove-item") {
    const items = order.querySelectorAll("[data-sale-item]");
    if (items.length > 1) button.closest("[data-sale-item]").remove();
  }
  updateSaleBuilderSummary();
});
saleForm.addEventListener("input", (event) => {
  const item = event.target.closest("[data-sale-item]");
  if (!item) return;
  updateSaleItem(item, event.target.dataset.saleField === "code");
});
saleForm.addEventListener("change", (event) => {
  if (event.target.name === "channel") {
    updateSaleBuilderSummary();
    return;
  }
  const item = event.target.closest("[data-sale-item]");
  if (item) {
    if (event.target.dataset.saleField === "categoryId") {
      updateSaleProductOptions(item);
      updateSaleItem(item);
      updateSaleBuilderSummary();
      return;
    }
    updateSaleItem(item, event.target.dataset.saleField === "code");
    updateSaleBuilderSummary();
  }
});
saleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = saleForm.querySelector("button[type='submit']");
  const errorElement = $("#sale-form-error");
  errorElement.classList.add("hidden");
  errorElement.textContent = "";
  let payload;
  try {
    payload = collectSalesPayload();
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
    return;
  }
  button.disabled = true;
  button.textContent = "Đang xuất hàng...";
  try {
    const result = await api("/api/sales", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    resetSaleBuilder();
    await refreshAll();
    toast(
      `Đã xuất ${result.ordersCreated} đơn với ${result.itemsCreated} dòng sản phẩm.`
    );
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Xác nhận xuất tất cả";
  }
});

$("#product-search").addEventListener("input", (event) => {
  const term = event.target.value.trim().toLowerCase();
  renderProducts(
    state.products.filter((product) => (
      `${product.code} ${product.name} ${product.categoryName} ${product.size || ""} ${product.color || ""}`
        .toLowerCase()
        .includes(term)
    ))
  );
});

document.querySelectorAll(".period-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.reportPeriod = button.dataset.period;
    document.querySelectorAll(".period-button").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
    refreshReport().catch((error) => toast(error.message, "error"));
  });
});
$("#report-anchor").value = state.reportAnchor;
$("#report-anchor").addEventListener("change", (event) => {
  state.reportAnchor = event.target.value || localDateValue();
  refreshReport().catch((error) => toast(error.message, "error"));
});

$("#manager-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const editing = state.editingManagerId;
  const errorElement = $("#manager-form-error");
  const name = String(form.elements.name.value).trim();
  const phone = String(form.elements.phone.value).replace(/\s/g, "");
  const password = form.elements.password.value;
  errorElement.textContent = "";
  errorElement.classList.add("hidden");

  let validationMessage = "";
  let invalidField = null;
  if (!name) {
    validationMessage = "Tên người quản lý là trường bắt buộc.";
    invalidField = form.elements.name;
  } else if (!/^0\d{9}$/.test(phone)) {
    validationMessage = "Số điện thoại phải gồm đúng 10 số và bắt đầu bằng số 0.";
    invalidField = form.elements.phone;
  } else if (!editing && !password) {
    validationMessage = "Mật khẩu là trường bắt buộc.";
    invalidField = form.elements.password;
  } else if (password && password.length < 6) {
    validationMessage = "Mật khẩu phải có ít nhất 6 ký tự.";
    invalidField = form.elements.password;
  } else if (password && !/[^\p{L}\p{N}\s]/u.test(password)) {
    validationMessage = "Mật khẩu phải có ít nhất 1 ký tự đặc biệt.";
    invalidField = form.elements.password;
  }

  if (validationMessage) {
    errorElement.textContent = validationMessage;
    errorElement.classList.remove("hidden");
    invalidField.focus();
    return;
  }

  form.elements.phone.value = phone;
  const saved = await submitForm(
    form,
    editing ? `/api/managers/${editing}` : "/api/managers",
    editing ? "Đã cập nhật tài khoản quản lý." : "Đã thêm tài khoản quản lý.",
    editing ? "PUT" : "POST"
  );
  if (saved) resetManagerForm();
});
$("#cancel-manager-edit").addEventListener("click", resetManagerForm);
$("#manager-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-manager-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.dataset.managerAction === "edit") return startManagerEdit(id);
  const manager = state.managers.find((item) => item.id === id);
  if (!manager || !window.confirm(`Xóa tài khoản ${manager.name} (${manager.phone})?`)) return;
  try {
    await api(`/api/managers/${id}`, { method: "DELETE", body: "{}" });
    if (state.editingManagerId === id) resetManagerForm();
    await refreshCore();
    toast("Đã xóa tài khoản quản lý.");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#admin-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $("#admin-password-error");
  const currentPassword = form.elements.currentPassword.value;
  const newPassword = form.elements.newPassword.value;
  const confirmPassword = form.elements.confirmPassword.value;
  errorElement.textContent = "";
  errorElement.classList.add("hidden");

  let message = "";
  if (!currentPassword) {
    message = "Vui lòng nhập mật khẩu hiện tại.";
  } else if (newPassword.length < 8) {
    message = "Mật khẩu mới phải có ít nhất 8 ký tự.";
  } else if (newPassword !== confirmPassword) {
    message = "Mật khẩu mới và phần xác nhận không trùng khớp.";
  } else if (newPassword === currentPassword) {
    message = "Mật khẩu mới phải khác mật khẩu hiện tại.";
  }
  if (message) {
    errorElement.textContent = message;
    errorElement.classList.remove("hidden");
    return;
  }

  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Đang cập nhật...";
  try {
    await api("/api/admin/password", {
      method: "PUT",
      body: JSON.stringify(formData(form))
    });
    form.reset();
    toast("Đã cập nhật mật khẩu admin. Các phiên đăng nhập khác đã được đăng xuất.");
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Cập nhật mật khẩu admin";
  }
});

$("#today").textContent = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
}).format(new Date());

async function initialize() {
  try {
    const user = await api("/api/auth/me");
    showApp(user);
    const initialView = Object.prototype.hasOwnProperty.call(viewTitles, location.hash.slice(1))
      ? location.hash.slice(1)
      : "dashboard";
    showView(initialView);
    await refreshAll();
  } catch {
    showLogin();
  }
}

initialize();
