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
  orders: "Quản lý đơn hàng",
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
const orderStatusLabels = {
  pending_pickup: "Đang chờ lấy hàng",
  shipping: "Đang vận chuyển",
  delivered: "Đã giao",
  completed: "Hoàn thành",
  cancelled: "Đã Hủy",
  returned: "Trả Hàng"
};
const directSalesChannels = new Set(["facebook", "zalo", "website"]);
const marketplaceSalesChannels = new Set(["tiktok", "shopee", "lazada"]);
const lockedOrderStatuses = new Set(["completed", "returned", "cancelled"]);
const reversedOrderStatuses = new Set(["returned", "cancelled"]);
const productUnitLabels = {
  "đôi": "Đôi",
  "cái": "Cái",
  "chai": "Chai",
  "thùng": "Thùng",
  "cuộn": "Cuộn",
  "tờ": "Tờ",
  "sấp": "Sấp (500 tờ)"
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
  orders: [],
  salesConfig: { allowedCategories: [], addons: [] },
  nextOrderCode: null,
  dashboard: null,
  report: null,
  managers: [],
  reportPeriod: "day",
  reportAnchor: localDateValue(),
  productImage: null,
  editingManagerId: null,
  editingInventoryProductId: null,
  orderStatusFilter: "pending_pickup"
};

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

const filledFieldSelector = [
  "input:not([type='checkbox']):not([type='radio']):not([type='file'])",
  "select",
  "textarea"
].join(",");

function syncFilledField(field) {
  if (!field?.matches?.(filledFieldSelector)) return;
  field.classList.toggle("has-value", String(field.value ?? "").trim() !== "");
}

function syncFilledFields(root = document) {
  root.querySelectorAll(filledFieldSelector).forEach(syncFilledField);
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

function variantHtml(product) {
  const values = [];
  if (product.size) values.push(`Size ${text(product.size)}`);
  if (product.color) values.push(`<span class="variant-color">Màu ${text(product.color)}</span>`);
  return values.join(" · ") || "—";
}

function parseMoney(value) {
  const cleaned = String(value ?? "").replaceAll(",", "").replace(/\s/g, "");
  return cleaned === "" ? 0 : Number(cleaned);
}

function formatMoneyInputValue(value) {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
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

function unitOptions(selectedUnit = "") {
  return `<option value="">Chọn đơn vị</option>${Object.entries(productUnitLabels).map(
    ([unit, label]) => `<option value="${unit}"${selectedUnit === unit ? " selected" : ""}>${label}</option>`
  ).join("")}`;
}

function saleCategoryOptions(selectedId = "") {
  return `<option value="">Chọn danh mục</option>${state.salesConfig.allowedCategories.map((category) => (
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
  $("#current-role").textContent = `${user.role === "admin" ? "Quản trị viên" : "Quản lý"} · ${user.login || user.phone}`;
  $(".user-avatar").textContent = user.role === "admin" ? "A" : "Q";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", user.role !== "admin");
  });
}

function renderDashboard() {
  const report = state.dashboard;
  if (!report) return;
  const sellingFees = report.sellingFees ?? report.platformFees ?? 0;
  $("#dashboard-metrics").innerHTML = [
    metric("Doanh thu", money.format(report.revenue), "Chỉ tính sản phẩm chính", true),
    metric("Lợi nhuận", money.format(report.profit), `Đã trừ ${money.format(sellingFees)} phí bán hàng`),
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

  const visibleRecent = report.recent.filter((item) => item.lineRole !== "addon");
  $("#recent-transactions").innerHTML = visibleRecent.length
    ? visibleRecent.map((item) => {
      const details = item.kind === "IN"
        ? "Nhập hàng"
        : `Xuất hàng · ${item.orderCode || "Chưa có mã đơn"} · ${orderStatusLabels[item.orderStatus] || channelLabels[item.channel] || "Chưa xác định"}`;
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
    categorySelect.innerHTML = saleCategoryOptions(selectedCategory);
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
      const editingInventory = state.editingInventoryProductId === product.id;
      const stockCell = editingInventory
        ? `<input class="inventory-edit-input" data-inventory-value="stock" aria-label="Tồn kho" type="number" min="0" step="1" value="${product.stock}" />`
        : `<span class="stock${product.stock <= 5 ? " low" : ""}">${product.stock.toLocaleString("vi-VN")}</span>`;
      const shippingCell = editingInventory
        ? `<input class="inventory-edit-input money" data-inventory-value="shippingCost" aria-label="Phí vận chuyển" inputmode="numeric" data-money-input value="${formatMoneyInputValue(Math.round(product.shippingCost))}" />`
        : money.format(product.shippingCost);
      const landedCostCell = editingInventory
        ? `<input class="inventory-edit-input money" data-inventory-value="landedCost" aria-label="Giá vốn" inputmode="numeric" data-money-input value="${formatMoneyInputValue(Math.round(product.landedCost))}" />`
        : money.format(product.landedCost);
      const salePriceCell = editingInventory
        ? `<input class="inventory-edit-input money" data-inventory-value="salePrice" aria-label="Giá bán" inputmode="numeric" data-money-input value="${formatMoneyInputValue(Math.round(product.salePrice))}" />`
        : product.salePrice ? money.format(product.salePrice) : "—";
      const actions = editingInventory
        ? `<div class="inventory-edit-actions"><button class="mini-button primary" data-stock-action="save" data-id="${product.id}">Lưu</button><button class="mini-button" data-stock-action="cancel">Hủy</button></div>`
        : `<button class="mini-button" data-stock-action="edit" data-id="${product.id}">Sửa</button>`;
      return `<tr${editingInventory ? ' class="inventory-row-editing"' : ""}><td><div class="product-cell">${visual}<span class="product-name">${text(product.name)}</span></div></td><td><span class="category-chip">${text(product.categoryName)}</span></td><td class="product-code">${text(product.code)}</td><td>${variantHtml(product)}</td><td>${stockCell}</td><td>${text(product.unit)}</td><td>${money.format(product.costPrice)}</td><td>${shippingCell}</td><td class="product-name">${landedCostCell}</td><td>${salePriceCell}</td><td>${money.format(product.inventoryValue)}</td><td>${actions}</td></tr>`;
    }).join("")
    : `<tr><td colspan="12" class="empty">Chưa tìm thấy sản phẩm.</td></tr>`;
}

function renderHistories() {
  const receiptRows = state.transactions.filter((item) => item.kind === "IN");
  const saleRows = state.transactions.filter((item) => item.kind === "OUT");

  $("#receipt-history-table").innerHTML = receiptRows.length
    ? receiptRows.map((item) => {
      const shipping = Math.max(0, item.unitCost - item.unitPrice);
      return `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="operator-name">${text(item.operatorName || "Dữ liệu cũ")}</span></td><td><span class="category-chip">${text(item.categoryName)}</span></td><td class="product-code">${text(item.code)}</td><td>${variantHtml(item)}</td><td>${item.quantity.toLocaleString("vi-VN")}</td><td>${text(item.unit)}</td><td>${money.format(item.unitPrice)}</td><td>${money.format(shipping)}</td><td>${money.format(item.quantity * item.unitCost)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="10" class="empty">Chưa có lịch sử nhập hàng.</td></tr>`;
  $("#sale-history-table").innerHTML = saleRows.length
    ? saleRows.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="operator-name">${text(item.operatorName || "Dữ liệu cũ")}</span></td><td class="product-name">${text(item.orderCode || "—")}</td><td><span class="channel-chip">${text(channelLabels[item.channel] || "Chưa xác định")}</span></td><td>${item.lineRole === "addon" ? '<span class="history-line-role addon">Đi kèm</span>' : '<span class="history-line-role">Chính</span>'}</td><td>${text(item.name)}</td><td class="product-code">${text(item.code)}</td><td>${item.quantity.toLocaleString("vi-VN")}</td><td>${text(item.unit)}</td></tr>`).join("")
    : `<tr><td colspan="9" class="empty">Chưa có lịch sử xuất hàng.</td></tr>`;
  renderOrders();
}

function renderOrders() {
  const statuses = Object.keys(orderStatusLabels);
  $("#order-status-tabs").innerHTML = statuses.map((status) => {
    const count = state.orders.filter((order) => order.status === status).length;
    return `<button class="order-status-tab${state.orderStatusFilter === status ? " active" : ""}" data-order-filter="${status}">${text(orderStatusLabels[status])}<small>${count}</small></button>`;
  }).join("");

  const orders = state.orders.filter((order) => order.status === state.orderStatusFilter);
  $("#order-list").innerHTML = orders.length
    ? orders.map((order) => {
      const mainProducts = order.items.map((item) => (
        `<div class="order-main-product"><span><strong>${text(item.name)}</strong><small>${text(item.code)} · ${variantHtml(item)}</small></span><span class="order-product-quantity">${item.quantity.toLocaleString("vi-VN")} ${text(item.unit)}</span><strong>${money.format(item.unitPrice)}</strong></div>`
      )).join("");
      const addons = order.addons.length
        ? `<div class="order-addon-box"><span class="order-addon-title">Sản phẩm đi kèm</span><div>${order.addons.map((item) => (
          `<span class="order-addon-item"><strong>${text(item.name)}</strong><small>${item.quantity.toLocaleString("vi-VN")} ${text(item.unit)} · ${money.format(item.unitPrice)}</small></span>`
        )).join("")}</div></div>`
        : "";
      const locked = lockedOrderStatuses.has(order.status);
      const directChannel = directSalesChannels.has(order.channel);
      const customerDetails = directChannel
        ? `<div class="order-customer-box"><span><small>KHÁCH HÀNG</small><strong>${text(order.customerName || "—")}</strong></span><span><small>SỐ ĐIỆN THOẠI</small><strong>${text(order.customerPhone || "—")}</strong></span><span class="address"><small>ĐỊA CHỈ</small><strong>${text(order.customerAddress || "—")}</strong></span></div>`
        : "";
      const feeLabel = directChannel ? "PHÍ VẬN CHUYỂN" : "PHÍ SÀN";
      const feeAmount = directChannel ? order.shippingFee : order.platformFee;
      const feeDetail = directChannel
        ? "Đơn bán trực tiếp"
        : `${Number(order.platformFeePercent).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}% doanh thu`;
      const statusActions = Object.entries(orderStatusLabels).map(([status, label]) => {
        const active = order.status === status;
        return `<button class="order-status-action status-${status}${active ? " active" : ""}${reversedOrderStatuses.has(status) ? " danger" : ""}" data-order-status-action="${status}" data-id="${order.id}" aria-pressed="${active}"${active ? " aria-current=\"step\"" : ""}${locked || active ? " disabled" : ""}>${active ? '<span class="order-status-check" aria-hidden="true">✓</span>' : ""}<span>${text(label)}</span></button>`;
      }).join("");
      return `<article class="order-history-card">
        <header class="order-history-card-header"><div><strong>${text(order.orderCode)}</strong><small>${dateTime.format(new Date(order.createdAt))} · ${text(order.operatorName || "Dữ liệu cũ")}</small></div><div><span class="channel-chip">${text(channelLabels[order.channel] || "Chưa xác định")}</span><span class="order-status-badge status-${order.status}">${text(orderStatusLabels[order.status])}</span></div></header>
        ${customerDetails}
        <div class="order-main-products"><span class="order-section-label">Sản phẩm chính</span>${mainProducts}</div>
        ${addons}
        <div class="order-finance-tabs"><span><small>DOANH THU</small><strong>${money.format(order.revenue)}</strong></span><span><small>${feeLabel}</small><strong>${money.format(feeAmount)}</strong><em>${feeDetail}</em></span><span><small>GIÁ VỐN</small><strong>${money.format(order.cogs)}</strong></span><span class="profit"><small>LỢI NHUẬN</small><strong>${money.format(order.profit)}</strong></span></div>
        <div class="order-status-actions${locked ? " locked" : ""}"><span>${locked ? "Đơn đã kết thúc" : "Chuyển trạng thái đơn"}</span><div>${statusActions}</div></div>
      </article>`;
    }).join("")
    : `<p class="empty order-empty">Chưa có đơn ở trạng thái ${text(orderStatusLabels[state.orderStatusFilter].toLowerCase())}.</p>`;
}

function renderReport() {
  const report = state.report;
  if (!report) return;
  $("#report-range-label").textContent = report.range.startDate === report.range.endDate
    ? `Báo cáo ngày ${shortDate.format(new Date(`${report.range.startDate}T00:00:00`))}`
    : `Từ ${shortDate.format(new Date(`${report.range.startDate}T00:00:00`))} đến ${shortDate.format(new Date(`${report.range.endDate}T00:00:00`))}`;
  $("#report-metrics").innerHTML = [
    metric("Doanh thu", money.format(report.totals.revenue), "Tổng sản phẩm chính", true),
    metric("Phí bán hàng", money.format(report.totals.sellingFees ?? report.totals.platformFees), `${report.totals.orders.toLocaleString("vi-VN")} đơn hàng`),
    metric("Giá vốn", money.format(report.totals.cogs), `${report.totals.units.toLocaleString("vi-VN")} sản phẩm chính`),
    metric("Lợi nhuận", money.format(report.totals.profit), "Doanh thu − phí bán hàng − giá vốn")
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
  const channelRows = report.channels.map((item) => `<tr><td><span class="channel-chip">${text(channelLabels[item.channel] || item.channel)}</span></td><td>${item.orders.toLocaleString("vi-VN")}</td><td>${item.units.toLocaleString("vi-VN")}</td><td>${money.format(item.revenue)}</td><td>${money.format(item.sellingFees ?? item.platformFees)}</td><td>${money.format(item.cogs)}</td><td>${money.format(item.profit)}</td></tr>`).join("");
  $("#channel-table").innerHTML = `${channelRows}<tr class="channel-total"><td>TỔNG TẤT CẢ KÊNH</td><td>${report.totals.orders.toLocaleString("vi-VN")}</td><td>${report.totals.units.toLocaleString("vi-VN")}</td><td>${money.format(report.totals.revenue)}</td><td>${money.format(report.totals.sellingFees ?? report.totals.platformFees)}</td><td>${money.format(report.totals.cogs)}</td><td>${money.format(report.totals.profit)}</td></tr>`;
  $("#transaction-table").innerHTML = report.orders.length
    ? report.orders.map((order) => {
      const products = order.items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
      return `<tr><td class="muted">${dateTime.format(new Date(order.createdAt))}</td><td class="product-name">${text(order.orderCode)}</td><td><span class="channel-chip">${text(channelLabels[order.channel] || "Chưa xác định")}</span></td><td><span class="order-status-badge status-${order.status}">${text(orderStatusLabels[order.status])}</span></td><td title="${text(products)}">${text(products)}</td><td>${money.format(order.revenue)}</td><td>${money.format(order.sellingFee ?? order.platformFee)}</td><td>${money.format(order.cogs)}</td><td>${money.format(order.profit)}</td></tr>`;
    }).join("")
    : `<tr><td colspan="9" class="empty">Không có đơn hàng trong khoảng thời gian này.</td></tr>`;
}

function renderManagers() {
  $("#manager-limit").textContent = `${state.managers.length}/5`;
  $("#manager-table").innerHTML = state.managers.length
    ? state.managers.map((manager) => `<tr><td class="product-name">${text(manager.name)}</td><td>${text(manager.phone)}</td><td><span class="role-chip">Quản lý</span></td><td class="muted">${dateTime.format(new Date(manager.createdAt))}</td><td class="muted">${dateTime.format(new Date(manager.updatedAt))}</td><td><div class="action-buttons"><button class="mini-button" data-manager-action="edit" data-id="${manager.id}">Sửa</button><button class="mini-button danger" data-manager-action="delete" data-id="${manager.id}">Xóa</button></div></td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">Chưa có tài khoản quản lý.</td></tr>`;
}

function renderCategories() {
  const newProductSelect = $("#new-product-form").elements.categoryId;
  const selectedNewProductCategory = newProductSelect.value;
  newProductSelect.innerHTML = categoryOptions(selectedNewProductCategory);
  updateNewProductCategoryRules();
}

function findProduct(code) {
  return state.products.find(
    (product) => product.code.toLowerCase() === String(code).trim().toLowerCase()
  );
}

function updateNewProductCategoryRules() {
  const form = $("#new-product-form");
  const category = categoryById(form.elements.categoryId.value);
  const fields = category?.fields || {};
  const fieldElements = {
    size: $("#new-product-size-field"),
    color: $("#new-product-color-field"),
    shippingCost: $("#new-product-shipping-field"),
    salePrice: $("#new-product-sale-price-field"),
    image: $("#new-product-image-field")
  };
  Object.entries(fieldElements).forEach(([field, wrapper]) => {
    const visible = Boolean(fields[field]);
    const input = wrapper.querySelector("input");
    wrapper.classList.toggle("hidden", !visible);
    input.disabled = !visible;
    if (!visible) {
      if (field === "shippingCost") input.value = "0";
      else input.value = "";
    }
  });
  form.elements.size.required = Boolean(category?.requiresSize);
  const unitSelect = form.elements.unit;
  unitSelect.disabled = !category;
  if (!category) {
    unitSelect.innerHTML = `<option value="">Chọn danh mục trước</option>`;
  } else if (category.isDefault) {
    unitSelect.innerHTML = `<option value="${text(category.defaultUnit)}">${text(productUnitLabels[category.defaultUnit] || category.defaultUnit)}</option>`;
  } else {
    unitSelect.innerHTML = unitOptions(category.defaultUnit);
  }
  if (!fields.image) clearProductImage();
  $("#new-product-price-note").textContent = category ? `(${category.priceNote})` : "";
}

function generateSaleOrderCode(offset = 0) {
  const now = new Date();
  const date = state.nextOrderCode?.date || [
    String(now.getDate()).padStart(2, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    now.getFullYear()
  ].join("");
  const sequence = Number(state.nextOrderCode?.sequence || 1) + offset;
  return `TAHA-${date}-${String(sequence).padStart(3, "0")}`;
}

function saleItemTemplate() {
  return `<div class="sale-item-row" data-sale-item>
    <div class="sale-item-main">
      <label><span class="sale-field-title">Danh mục <b>*</b></span><select data-sale-field="categoryId">${saleCategoryOptions()}</select></label>
      <label class="sale-product-code"><span class="sale-field-title">Mã sản phẩm <b>*</b></span><select data-sale-field="code" disabled><option value="">Chọn danh mục trước</option></select></label>
      <div class="sale-product-preview" data-sale-preview><span class="sale-preview-placeholder">?</span><span><strong>Chưa chọn sản phẩm</strong><small>Chọn danh mục rồi chọn mã hàng</small><small class="sale-stock-note" data-sale-stock-note aria-live="polite">Tồn kho sẽ hiện sau khi chọn</small></span></div>
      <label><span class="sale-field-title">Số lượng <b>*</b></span><input data-sale-field="quantity" type="number" min="1" step="1" value="1" /></label>
      <label><span class="sale-field-title">Giá bán <b>*</b></span><input data-sale-field="salePrice" inputmode="numeric" data-money-input placeholder="0" /></label>
      <div class="sale-line-total"><span>Thành tiền dự kiến</span><strong data-sale-total>${money.format(0)}</strong></div>
      <button class="sale-remove-button" type="button" data-sale-action="remove-item" aria-label="Xóa sản phẩm" title="Xóa sản phẩm">×</button>
    </div>
    <div class="sale-linked-fields hidden" data-sale-linked-fields>
      <span class="hidden" data-sale-linked="size"><small>SIZE</small><strong>—</strong></span>
      <span class="hidden" data-sale-linked="color"><small>MÀU SẮC</small><strong>—</strong></span>
      <span data-sale-linked="unit"><small>ĐƠN VỊ</small><strong>—</strong></span>
    </div>
    <div class="sale-addon-preview hidden" data-sale-addons></div>
  </div>`;
}

function saleOrderTemplate(orderCode = "") {
  return `<section class="sale-order-card" data-sale-order>
    <div class="sale-order-header">
      <div class="sale-order-title"><span class="sale-order-number" data-sale-order-number>Đơn hàng</span><small>Nhiều sản phẩm chính trong cùng một mã đơn</small></div>
      <label class="sale-order-code">Mã đơn hàng <span class="required-star">*</span><input class="uppercase-input" data-sale-field="orderCode" value="${text(orderCode)}" maxlength="64" placeholder="Nhập mã đơn từ sàn" /><small data-sale-code-help>Chọn kênh bán hàng trước</small></label>
      <button class="sale-remove-order" type="button" data-sale-action="remove-order">Xóa đơn</button>
    </div>
    <div class="sale-customer-fields hidden" data-sale-customer-fields>
      <label><span class="sale-field-title">Tên khách hàng <b>*</b></span><input data-sale-field="customerName" maxlength="120" placeholder="Nhập tên khách hàng" /></label>
      <label><span class="sale-field-title">Số điện thoại <b>*</b></span><input data-sale-field="customerPhone" inputmode="numeric" maxlength="10" placeholder="VD: 0912345678" /></label>
      <label class="customer-address"><span class="sale-field-title">Địa chỉ <b>*</b></span><textarea data-sale-field="customerAddress" maxlength="300" rows="2" placeholder="Nhập địa chỉ giao hàng đầy đủ"></textarea></label>
    </div>
    <div class="sale-order-items">${saleItemTemplate()}</div>
    <button class="sale-add-item" type="button" data-sale-action="add-item">+ Thêm sản phẩm</button>
    <div class="sale-order-summary">
      <div class="sale-draft-finances">
        <span><small>DOANH THU</small><strong data-draft-revenue>${money.format(0)}</strong></span>
        <label class="sale-finance-fee"><small><span data-sale-fee-label>PHÍ BÁN HÀNG</span> · <b data-sale-fee-channel>KÊNH ĐÃ CHỌN</b></small><input aria-label="Phí bán hàng" data-sale-field="channelFee" inputmode="numeric" data-money-input value="0" /><em data-sale-fee-percent>Chọn kênh bán</em></label>
        <span class="sale-finance-cogs"><small>GIÁ VỐN</small><strong data-draft-cogs>${money.format(0)}</strong><em class="sale-cogs-breakdown" data-draft-cogs-breakdown>Chưa có dữ liệu giá vốn</em></span>
        <span class="profit"><small>LỢI NHUẬN</small><strong data-draft-profit>${money.format(0)}</strong></span>
      </div>
    </div>
  </section>`;
}

function updateSaleProductOptions(item) {
  const categoryId = Number(item.querySelector("[data-sale-field='categoryId']").value);
  const codeSelect = item.querySelector("[data-sale-field='code']");
  const previousCode = codeSelect.value;
  const products = state.products.filter((product) => (
    product.categoryId === categoryId && state.salesConfig.allowedCategories.some((category) => (
      category.id === product.categoryId
    ))
  ));
  codeSelect.innerHTML = !categoryId
    ? `<option value="">Chọn danh mục trước</option>`
    : `<option value="">Chọn mã sản phẩm</option>${products.map((product) => (
      `<option value="${text(product.code)}"${product.code === previousCode ? " selected" : ""}>${text(productOptionLabel(product))}</option>`
    )).join("")}`;
  codeSelect.disabled = !categoryId || !$("#sale-form").elements.channel.value;
}

function updateOrderFinancials(order) {
  let revenue = 0;
  let cogs = 0;
  let shoeUnits = 0;
  const cogsParts = [];
  order.querySelectorAll("[data-sale-item]").forEach((item) => {
    const product = findProduct(item.querySelector("[data-sale-field='code']").value);
    const quantity = Math.max(0, Number(item.querySelector("[data-sale-field='quantity']").value) || 0);
    const price = Math.max(0, parseMoney(item.querySelector("[data-sale-field='salePrice']").value) || 0);
    revenue += quantity * price;
    if (product) {
      const lineCogs = quantity * product.landedCost;
      cogs += lineCogs;
      if (quantity > 0) {
        cogsParts.push({ label: product.name, amount: lineCogs });
      }
      if (product.categoryName === "Giày") shoeUnits += quantity;
    }
  });
  if (shoeUnits > 0) {
    for (const addon of state.salesConfig.addons) {
      const quantity = addon.perOrder ? addon.quantity : addon.quantity * shoeUnits;
      const addonCogs = quantity * addon.price;
      cogs += addonCogs;
      cogsParts.push({ label: addon.categoryName, amount: addonCogs });
    }
  }
  const feeInput = order.querySelector("[data-sale-field='channelFee']");
  const fee = Math.max(0, parseMoney(feeInput.value) || 0);
  const profit = revenue - fee - cogs;
  order.querySelector("[data-draft-revenue]").textContent = money.format(revenue);
  order.querySelector("[data-draft-cogs]").textContent = money.format(cogs);
  order.querySelector("[data-draft-cogs-breakdown]").textContent = cogsParts.length
    ? cogsParts.map((part) => `${part.label} ${money.format(part.amount)}`).join(" + ")
    : "Chưa có dữ liệu giá vốn";
  order.querySelector("[data-draft-profit]").textContent = money.format(profit);
  const directChannel = directSalesChannels.has($("#sale-form").elements.channel.value);
  order.querySelector("[data-sale-fee-percent]").textContent = directChannel
    ? "Phí giao hàng"
    : `${revenue > 0 ? (fee * 100 / revenue).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) : "0"}% doanh thu`;
}

function applySaleChannelMode(resetFee = false) {
  const channel = $("#sale-form").elements.channel.value;
  const directChannel = directSalesChannels.has(channel);
  const marketplaceChannel = marketplaceSalesChannels.has(channel);
  [...document.querySelectorAll("[data-sale-order]")].forEach((order, index) => {
    const codeInput = order.querySelector("[data-sale-field='orderCode']");
    if (directChannel) {
      codeInput.value = generateSaleOrderCode(index);
      codeInput.dataset.generated = "true";
    } else if (marketplaceChannel && codeInput.dataset.generated === "true") {
      codeInput.value = "";
      delete codeInput.dataset.generated;
    }
    if (resetFee) {
      order.querySelector("[data-sale-field='channelFee']").value = "0";
    }
  });
}

function updateSaleBuilderSummary() {
  const orders = [...document.querySelectorAll("[data-sale-order]")];
  const channel = $("#sale-form").elements.channel.value;
  const channelReady = Boolean(channel);
  const directChannel = directSalesChannels.has(channel);
  const channelName = channelLabels[channel] || "kênh đã chọn";
  $("#sale-orders").classList.toggle("locked", !channelReady);
  $("#sale-form [data-sale-action='add-order']").disabled = !channelReady;
  orders.forEach((order, index) => {
    order.querySelector("[data-sale-order-number]").textContent = `Đơn hàng ${index + 1}`;
    order.querySelector("[data-sale-fee-channel]").textContent = channelName.toUpperCase();
    order.querySelector("[data-sale-fee-label]").textContent = directChannel
      ? "PHÍ VẬN CHUYỂN"
      : "PHÍ SÀN";
    const codeInput = order.querySelector("[data-sale-field='orderCode']");
    codeInput.disabled = !channelReady;
    codeInput.readOnly = directChannel;
    codeInput.placeholder = directChannel ? "Hệ thống tự tạo mã" : "Nhập mã đơn từ sàn";
    order.querySelector("[data-sale-code-help]").textContent = !channelReady
      ? "Chọn kênh bán hàng trước"
      : directChannel
        ? "Mã được hệ thống tự động tạo"
        : "Nhập đúng mã đơn trên sàn bán hàng";
    const feeInput = order.querySelector("[data-sale-field='channelFee']");
    feeInput.disabled = !channelReady;
    feeInput.setAttribute("aria-label", directChannel ? "Phí vận chuyển" : "Phí sàn");
    const customerFields = order.querySelector("[data-sale-customer-fields]");
    customerFields.classList.toggle("hidden", !directChannel);
    customerFields.querySelectorAll("input, textarea").forEach((field) => {
      field.disabled = !directChannel;
      field.required = directChannel;
    });
    order.querySelector("[data-sale-action='add-item']").disabled = !channelReady;
    order.querySelector("[data-sale-action='remove-order']").disabled = !channelReady || orders.length === 1;
    const items = [...order.querySelectorAll("[data-sale-item]")];
    items.forEach((item) => {
      const categoryReady = Boolean(item.querySelector("[data-sale-field='categoryId']").value);
      const productReady = Boolean(item.querySelector("[data-sale-field='code']").value);
      item.querySelectorAll("input, select").forEach((field) => {
        const isProductCode = field.dataset.saleField === "code";
        const isCategory = field.dataset.saleField === "categoryId";
        field.disabled = !channelReady || (isProductCode && !categoryReady) || (!isCategory && !isProductCode && !productReady);
      });
      item.querySelector("[data-sale-action='remove-item']").disabled = !channelReady || items.length === 1;
    });
    updateOrderFinancials(order);
    syncFilledFields(order);
  });
  const itemCount = document.querySelectorAll("[data-sale-item]").length;
  $("#sale-batch-summary").textContent = `${orders.length} đơn hàng · ${itemCount} sản phẩm chính`;
}

function updateSaleStockStatus(item, product) {
  const quantityInput = item.querySelector("[data-sale-field='quantity']");
  const stockNote = item.querySelector("[data-sale-stock-note]");
  const quantity = Number(quantityInput.value);
  if (!product) {
    quantityInput.removeAttribute("max");
    quantityInput.classList.remove("stock-insufficient");
    quantityInput.setAttribute("aria-invalid", "false");
    stockNote.classList.remove("error");
    stockNote.textContent = "Tồn kho sẽ hiện sau khi chọn";
    return true;
  }

  const stock = Math.max(0, Number(product.stock) || 0);
  const insufficient = Number.isFinite(quantity) && quantity > stock;
  quantityInput.max = String(stock);
  quantityInput.classList.toggle("stock-insufficient", insufficient);
  quantityInput.setAttribute("aria-invalid", String(insufficient));
  stockNote.classList.toggle("error", insufficient);
  stockNote.textContent = insufficient
    ? `Tồn không đủ · còn ${stock.toLocaleString("vi-VN")} ${product.unit}`
    : `Tồn: ${stock.toLocaleString("vi-VN")} ${product.unit}`;
  return !insufficient;
}

function updateSaleItem(item, prefillPrice = false) {
  const codeInput = item.querySelector("[data-sale-field='code']");
  const priceInput = item.querySelector("[data-sale-field='salePrice']");
  const quantityInput = item.querySelector("[data-sale-field='quantity']");
  const product = findProduct(codeInput.value);
  const preview = item.querySelector("[data-sale-preview]");
  const addonPreview = item.querySelector("[data-sale-addons]");
  const linkedFields = item.querySelector("[data-sale-linked-fields]");
  if (product) {
    if (prefillPrice) priceInput.value = formatMoneyInputValue(product.salePrice);
    const visual = product.image ? `<img src="${product.image}" alt="" />` : `<span class="sale-preview-placeholder">${text(product.name.slice(0, 1).toUpperCase())}</span>`;
    preview.innerHTML = `${visual}<span><strong>${text(product.name)}</strong><small>${text(product.code)} · ${variantHtml(product)}</small><small class="sale-stock-note" data-sale-stock-note aria-live="polite"></small></span>`;
    preview.classList.add("found");
    const category = categoryById(product.categoryId);
    const sizeField = linkedFields.querySelector("[data-sale-linked='size']");
    const colorField = linkedFields.querySelector("[data-sale-linked='color']");
    sizeField.classList.toggle("hidden", !category?.fields?.size);
    colorField.classList.toggle("hidden", !category?.fields?.color);
    sizeField.querySelector("strong").textContent = product.size || "—";
    colorField.querySelector("strong").textContent = product.color || "—";
    linkedFields.querySelector("[data-sale-linked='unit'] strong").textContent =
      product.unit === "tờ" && product.categoryName === "Giấy in" ? "Tờ (1/500 sấp)" : product.unit;
    linkedFields.classList.remove("hidden");
  } else {
    preview.innerHTML = `<span class="sale-preview-placeholder">?</span><span><strong>Chưa chọn sản phẩm</strong><small>Chọn danh mục rồi chọn mã hàng</small><small class="sale-stock-note" data-sale-stock-note aria-live="polite"></small></span>`;
    preview.classList.remove("found");
    linkedFields.classList.add("hidden");
  }
  updateSaleStockStatus(item, product);
  const quantity = Math.max(0, Number(quantityInput.value) || 0);
  const price = Math.max(0, parseMoney(priceInput.value) || 0);
  item.querySelector("[data-sale-total]").textContent = money.format(quantity * price);
  if (product?.categoryName === "Giày") {
    addonPreview.innerHTML = `<span>Sản phẩm đi kèm mặc định</span><div>${state.salesConfig.addons.map((addon) => {
      const addonQuantity = addon.perOrder ? addon.quantity : addon.quantity * quantity;
      return `<span class="sale-addon-chip${addon.product ? "" : " missing"}"><strong>${text(addon.categoryName)}</strong><small>${addon.perOrder ? "1 tờ / đơn" : `${addonQuantity} ${text(addon.unit)}`} · ${money.format(addon.price)}${addon.product ? ` · ${text(addon.product.code)}` : " · chưa có tồn"}</small></span>`;
    }).join("")}</div>`;
    addonPreview.classList.remove("hidden");
  } else {
    addonPreview.innerHTML = "";
    addonPreview.classList.add("hidden");
  }
  const order = item.closest("[data-sale-order]");
  syncFilledFields(item);
  if (order) updateOrderFinancials(order);
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
  const directChannel = directSalesChannels.has(channel);
  const seenOrderCodes = new Set();
  const stockNeeded = new Map();
  const orders = [...form.querySelectorAll("[data-sale-order]")].map((order, orderIndex) => {
    const orderCode = order.querySelector("[data-sale-field='orderCode']").value.trim().toUpperCase();
    if (!orderCode) throw new Error(`Vui lòng nhập mã cho đơn hàng ${orderIndex + 1}.`);
    if (!/^[A-Z0-9._/-]+$/.test(orderCode) || orderCode.length > 64) throw new Error(`Mã đơn ${orderCode} không đúng định dạng.`);
    if (seenOrderCodes.has(orderCode)) throw new Error(`Mã đơn ${orderCode} đang bị nhập trùng.`);
    seenOrderCodes.add(orderCode);
    const seenProductCodes = new Set();
    let shoeUnits = 0;
    const items = [...order.querySelectorAll("[data-sale-item]")].map((item, itemIndex) => {
      const categoryId = Number(item.querySelector("[data-sale-field='categoryId']").value);
      const category = state.salesConfig.allowedCategories.find((entry) => entry.id === categoryId);
      if (!category) throw new Error(`Vui lòng chọn danh mục ở dòng ${itemIndex + 1}.`);
      const code = item.querySelector("[data-sale-field='code']").value.trim().toUpperCase();
      const product = findProduct(code);
      if (!product) throw new Error(`Không tìm thấy sản phẩm ở dòng ${itemIndex + 1} của đơn ${orderCode}.`);
      if (seenProductCodes.has(product.code)) throw new Error(`Sản phẩm ${product.code} bị lặp trong đơn ${orderCode}.`);
      if (product.categoryId !== categoryId) throw new Error(`Sản phẩm ${product.code} không thuộc danh mục ${category.name}.`);
      seenProductCodes.add(product.code);
      const quantity = Number(item.querySelector("[data-sale-field='quantity']").value);
      const salePrice = parseMoney(item.querySelector("[data-sale-field='salePrice']").value);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Số lượng của ${product.code} phải là số nguyên lớn hơn 0.`);
      if (!Number.isFinite(salePrice) || salePrice < 0) throw new Error(`Giá bán của ${product.code} không hợp lệ.`);
      stockNeeded.set(product.code, (stockNeeded.get(product.code) || 0) + quantity);
      if (product.categoryName === "Giày") shoeUnits += quantity;
      return { categoryId, code: product.code, quantity, salePrice };
    });
    if (shoeUnits > 0) {
      for (const addon of state.salesConfig.addons) {
        if (!addon.product) throw new Error(`Chưa có tồn kho sản phẩm đi kèm ${addon.categoryName}.`);
        const quantity = addon.perOrder ? addon.quantity : addon.quantity * shoeUnits;
        stockNeeded.set(addon.product.code, (stockNeeded.get(addon.product.code) || 0) + quantity);
      }
    }
    const channelFee = parseMoney(order.querySelector("[data-sale-field='channelFee']").value);
    if (!Number.isFinite(channelFee) || channelFee < 0) {
      throw new Error(`${directChannel ? "Phí vận chuyển" : "Phí sàn"} của đơn ${orderCode} không hợp lệ.`);
    }
    let customerName = null;
    let customerPhone = null;
    let customerAddress = null;
    if (directChannel) {
      customerName = order.querySelector("[data-sale-field='customerName']").value.trim();
      customerPhone = order.querySelector("[data-sale-field='customerPhone']").value.replace(/[\s.-]/g, "");
      customerAddress = order.querySelector("[data-sale-field='customerAddress']").value.trim();
      if (!customerName) throw new Error(`Vui lòng nhập tên khách hàng cho đơn ${orderCode}.`);
      if (!/^0\d{9}$/.test(customerPhone)) {
        throw new Error(`Số điện thoại khách hàng của đơn ${orderCode} phải gồm đúng 10 số và bắt đầu bằng số 0.`);
      }
      if (!customerAddress) throw new Error(`Vui lòng nhập địa chỉ cho đơn ${orderCode}.`);
    }
    return {
      orderCode,
      platformFee: directChannel ? 0 : channelFee,
      shippingFee: directChannel ? channelFee : 0,
      customerName,
      customerPhone,
      customerAddress,
      items
    };
  });
  for (const [code, quantity] of stockNeeded) {
    const product = findProduct(code);
    if (!product || quantity > product.stock) throw new Error(`Sản phẩm ${code} cần ${quantity}, nhưng trong kho chỉ còn ${product?.stock || 0}.`);
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
    api("/api/transactions"),
    api("/api/orders"),
    api("/api/sales/config"),
    api("/api/orders/next-code")
  ];
  if (state.currentUser?.role === "admin") requests.push(api("/api/managers"));
  const [dashboard, categories, products, transactions, orders, salesConfig, nextOrderCode, managers = []] = await Promise.all(requests);
  state.dashboard = dashboard;
  state.categories = categories;
  state.products = products;
  state.transactions = transactions;
  state.orders = orders;
  state.salesConfig = salesConfig;
  state.nextOrderCode = nextOrderCode;
  state.managers = managers;
  if (!$("#sale-form").elements.channel.value) resetSaleBuilder();
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

document.addEventListener("input", (event) => {
  if (event.target.matches("[data-money-input]")) {
    event.target.value = formatMoneyInputValue(event.target.value);
  }
  if (event.target.matches(".uppercase-input")) {
    event.target.value = event.target.value.toUpperCase();
  }
  syncFilledField(event.target);
});

document.addEventListener("change", (event) => syncFilledField(event.target));
document.addEventListener("reset", (event) => {
  requestAnimationFrame(() => syncFilledFields(event.target));
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorElement = $("#login-error");
  const login = String(form.elements.login.value).trim();
  const password = form.elements.password.value;
  errorElement.classList.add("hidden");
  errorElement.textContent = "";
  if (login.length < 3 || login.length > 80) {
    errorElement.textContent = "Tên đăng nhập phải có từ 3 đến 80 ký tự.";
    errorElement.classList.remove("hidden");
    form.elements.login.focus();
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
    "Đã nhập hàng và cập nhật tồn kho.",
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
function updateCategorySubmitState() {
  categoryForm.querySelector("button[type='submit']").disabled =
    !categoryForm.elements.name.value.trim();
}
categoryForm.elements.name.addEventListener("input", updateCategorySubmitState);
categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitForm(
    categoryForm,
    "/api/categories",
    "Đã thêm danh mục hàng hóa mới."
  );
  updateCategorySubmitState();
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
    applySaleChannelMode();
  } else if (action === "remove-order") {
    if (saleForm.querySelectorAll("[data-sale-order]").length > 1) {
      order.remove();
      applySaleChannelMode();
    }
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
  if (item) {
    updateSaleItem(item, event.target.dataset.saleField === "code");
  } else {
    const order = event.target.closest("[data-sale-order]");
    if (order) updateOrderFinancials(order);
  }
});
saleForm.addEventListener("change", (event) => {
  if (event.target.name === "channel") {
    applySaleChannelMode(true);
    saleForm.querySelectorAll("[data-sale-item]").forEach((item) => updateSaleProductOptions(item));
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
    state.orderStatusFilter = "pending_pickup";
    await refreshAll();
    resetSaleBuilder();
    const codes = Array.isArray(result.orderCodes) ? ` Mã đơn: ${result.orderCodes.join(", ")}.` : "";
    toast(`Đã tạo ${result.ordersCreated} đơn với ${result.mainItemsCreated} sản phẩm chính.${codes}`);
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Xác nhận xuất tất cả";
  }
});

$("#order-status-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-order-filter]");
  if (!button) return;
  state.orderStatusFilter = button.dataset.orderFilter;
  renderOrders();
});

$("#order-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-order-status-action]");
  if (!button || button.disabled) return;
  const status = button.dataset.orderStatusAction;
  const id = Number(button.dataset.id);
  if (lockedOrderStatuses.has(status)) {
    const confirmed = window.confirm(
      status === "completed"
        ? "Xác nhận hoàn thành đơn? Sau khi hoàn thành, đơn sẽ kết thúc và không thể chuyển trạng thái nữa."
        : status === "returned"
          ? "Xác nhận trả hàng? Toàn bộ sản phẩm sẽ được cộng lại vào tồn kho, doanh thu đơn sẽ về 0 và không thể chuyển trạng thái nữa."
          : "Xác nhận hủy đơn? Toàn bộ sản phẩm sẽ được cộng lại vào tồn kho, doanh thu đơn sẽ về 0 và không thể chuyển trạng thái nữa."
    );
    if (!confirmed) return;
  }
  button.disabled = true;
  try {
    await api(`/api/orders/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    state.orderStatusFilter = status;
    await refreshAll();
    toast(reversedOrderStatuses.has(status)
      ? "Đã hoàn toàn bộ sản phẩm về kho và cập nhật doanh thu."
      : status === "completed"
        ? "Đơn đã hoàn thành và kết thúc trạng thái."
        : `Đã chuyển đơn sang ${orderStatusLabels[status].toLowerCase()}.`);
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
});

$("#product-table").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-stock-action]");
  if (!button) return;
  const action = button.dataset.stockAction;
  if (action === "edit") {
    state.editingInventoryProductId = Number(button.dataset.id);
    renderProducts();
    $("#product-table [data-inventory-value='stock']")?.focus();
    return;
  }
  if (action === "cancel") {
    state.editingInventoryProductId = null;
    renderProducts();
    return;
  }
  if (action === "save") {
    const id = Number(button.dataset.id);
    const row = button.closest("tr");
    const stock = Number(row.querySelector("[data-inventory-value='stock']").value);
    const shippingCost = parseMoney(row.querySelector("[data-inventory-value='shippingCost']").value);
    const landedCost = parseMoney(row.querySelector("[data-inventory-value='landedCost']").value);
    const salePrice = parseMoney(row.querySelector("[data-inventory-value='salePrice']").value);
    if (!Number.isInteger(stock) || stock < 0) {
      toast("Số lượng tồn phải là số nguyên không âm.", "error");
      return;
    }
    if (![shippingCost, landedCost, salePrice].every((value) => Number.isFinite(value) && value >= 0)) {
      toast("Phí vận chuyển, giá vốn và giá bán phải là số không âm.", "error");
      return;
    }
    if (landedCost < shippingCost) {
      toast("Giá vốn không được nhỏ hơn phí vận chuyển.", "error");
      return;
    }
    button.disabled = true;
    try {
      await api(`/api/products/${id}/inventory`, {
        method: "PUT",
        body: JSON.stringify({ stock, shippingCost, landedCost, salePrice })
      });
      state.editingInventoryProductId = null;
      await refreshAll();
      toast("Đã cập nhật tồn kho, phí vận chuyển, giá vốn và giá bán.");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
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

const adminDataResetForm = $("#admin-data-reset-form");
const adminDataResetButton = $("#admin-data-reset-button");
adminDataResetForm.elements.confirmed.addEventListener("change", () => {
  adminDataResetButton.disabled = !adminDataResetForm.elements.confirmed.checked;
});

adminDataResetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorElement = $("#admin-data-reset-error");
  errorElement.textContent = "";
  errorElement.classList.add("hidden");
  if (!adminDataResetForm.elements.confirmed.checked) {
    errorElement.textContent = "Bạn cần xác nhận đã hiểu dữ liệu sẽ bị xóa vĩnh viễn.";
    errorElement.classList.remove("hidden");
    return;
  }
  if (!window.confirm(
    "Xóa toàn bộ dữ liệu nhập hàng, xuất hàng và lịch sử? Thao tác này không thể hoàn tác."
  )) return;

  adminDataResetButton.disabled = true;
  adminDataResetButton.textContent = "ĐANG XÓA DỮ LIỆU...";
  try {
    const result = await api("/api/admin/operational-data", {
      method: "DELETE",
      body: JSON.stringify({
        password: adminDataResetForm.elements.password.value,
        confirmation: "DELETE_OPERATIONAL_DATA"
      })
    });
    adminDataResetForm.reset();
    state.orderStatusFilter = "pending_pickup";
    resetSaleBuilder();
    await refreshAll();
    toast(
      `Đã xóa ${result.deleted.products.toLocaleString("vi-VN")} sản phẩm và ${result.deleted.orders.toLocaleString("vi-VN")} đơn hàng cùng toàn bộ lịch sử.`
    );
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.classList.remove("hidden");
    toast(error.message, "error");
  } finally {
    adminDataResetButton.textContent = "XÓA TOÀN BỘ DỮ LIỆU";
    adminDataResetButton.disabled = !adminDataResetForm.elements.confirmed.checked;
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

syncFilledFields();
initialize();
