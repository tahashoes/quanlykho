const $ = (selector) => document.querySelector(selector);
const state = { products: [], dashboard: null, transactions: [] };
const money = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });
const viewTitles = { dashboard: "Tổng quan kho hàng", goods: "Nhập hàng", sales: "Xuất hàng", inventory: "Quản lý tồn kho", reports: "Báo cáo thống kê" };

function apiHeaders() {
  const token = localStorage.getItem("inventory-api-token") || "";
  return { "Content-Type": "application/json", ...(token ? { "X-API-Key": token } : {}) };
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Không thể kết nối tới máy chủ.");
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
  return String(value ?? "").replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function metric(label, value, note, accent = false) {
  return `<article class="metric${accent ? " teal" : ""}"><span class="metric-label">${label}</span><strong>${value}</strong><small>${note}</small></article>`;
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
  const lowProducts = state.products.filter((product) => product.stock <= 5).sort((a, b) => a.stock - b.stock).slice(0, 5);
  $("#low-stock").innerHTML = lowProducts.length ? lowProducts.map((product) => `<div class="compact-row"><span class="row-icon">!</span><div class="row-copy"><strong>${text(product.name)}</strong><small>${text(product.code)}</small></div><div class="row-value">${product.stock}<small>còn lại</small></div></div>`).join("") : `<p class="empty">Kho hàng đang ở mức an toàn.</p>`;
  $("#recent-transactions").innerHTML = report.recent.length ? report.recent.map((item) => `<div class="compact-row"><span class="row-icon ${item.kind === "OUT" ? "out" : ""}">${item.kind === "IN" ? "+" : "−"}</span><div class="row-copy"><strong>${text(item.name)}</strong><small>${item.kind === "IN" ? "Nhập hàng" : "Xuất hàng"} · ${dateTime.format(new Date(item.createdAt))}</small></div><div class="row-value">${item.kind === "IN" ? "+" : "−"}${item.quantity}<small>${money.format(item.quantity * item.unitPrice)}</small></div></div>`).join("") : `<p class="empty">Chưa có giao dịch nào.</p>`;
}

function renderProductOptions() {
  $("#product-codes").innerHTML = state.products.map((product) => `<option value="${text(product.code)}">${text(product.name)}</option>`).join("");
}

function renderProducts(products = state.products) {
  $("#product-table").innerHTML = products.length ? products.map((product) => `<tr><td>${text(product.code)}</td><td class="product-name">${text(product.name)}</td><td><span class="stock${product.stock <= 5 ? " low" : ""}">${product.stock}</span></td><td>${money.format(product.costPrice)}</td><td>${money.format(product.salePrice)}</td><td>${money.format(product.inventoryValue)}</td><td class="muted">${dateTime.format(new Date(product.updatedAt))}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">Chưa tìm thấy sản phẩm.</td></tr>`;
}

function renderReports() {
  const report = state.dashboard;
  if (!report) return;
  $("#report-metrics").innerHTML = [
    metric("Doanh thu", money.format(report.revenue), "Tổng tiền xuất hàng", true),
    metric("Chi phí nhập hàng", money.format(report.purchaseExpense), "Tổng tiền đã nhập kho"),
    metric("Giá vốn hàng bán", money.format(report.cogs), "Giá vốn của hàng đã xuất"),
    metric("Lợi nhuận", money.format(report.profit), "Doanh thu − giá vốn")
  ].join("");
  $("#transaction-table").innerHTML = state.transactions.length ? state.transactions.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="kind ${item.kind === "IN" ? "in" : "out"}">${item.kind === "IN" ? "NHẬP" : "XUẤT"}</span></td><td>${text(item.code)}</td><td class="product-name">${text(item.name)}</td><td>${item.quantity}</td><td>${money.format(item.unitPrice)}</td><td>${money.format(item.quantity * item.unitPrice)}</td></tr>`).join("") : `<tr><td colspan="7" class="empty">Chưa có giao dịch nào.</td></tr>`;
}

function findProduct(code) {
  return state.products.find((product) => product.code.toLowerCase() === String(code).trim().toLowerCase());
}

function fillProductFields(form, showStock = false) {
  const product = findProduct(form.elements.code.value);
  form.elements.name.value = product ? product.name : "";
  if (product && form.elements.salePrice && !form.elements.salePrice.value) form.elements.salePrice.value = product.salePrice;
  if (showStock) $("#sale-stock-hint").textContent = product ? `Hiện còn ${product.stock} đơn vị · giá bán gợi ý ${money.format(product.salePrice)}.` : "Không tìm thấy sản phẩm theo mã đã nhập.";
}

async function refresh() {
  try {
    const [dashboard, products, transactions] = await Promise.all([api("/api/dashboard"), api("/api/products"), api("/api/transactions")]);
    state.dashboard = dashboard;
    state.products = products;
    state.transactions = transactions;
    renderDashboard(); renderProductOptions(); renderProducts(); renderReports();
  } catch (error) {
    toast(error.message, "error");
  }
}

function showView(view) {
  document.querySelectorAll(".view").forEach((element) => element.classList.toggle("active", element.id === `${view}-view`));
  document.querySelectorAll(".nav-link").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $("#page-title").textContent = viewTitles[view];
  window.location.hash = view;
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }

async function submitForm(form, endpoint, message) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true; button.textContent = "Đang lưu...";
  try {
    await api(endpoint, { method: "POST", body: JSON.stringify(formData(form)) });
    form.reset();
    if (form.id === "sale-form") $("#sale-stock-hint").textContent = "Chọn mã sản phẩm để xem số lượng tồn.";
    await refresh();
    toast(message);
  } catch (error) { toast(error.message, "error"); }
  finally { button.disabled = false; button.textContent = form.dataset.buttonText; }
}

document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.go)));

const newProductForm = $("#new-product-form"); newProductForm.dataset.buttonText = "Lưu hàng hóa";
newProductForm.addEventListener("submit", (event) => { event.preventDefault(); submitForm(newProductForm, "/api/products", "Đã thêm hàng hóa vào kho."); });
const receiveForm = $("#receive-form"); receiveForm.dataset.buttonText = "Xác nhận nhập";
receiveForm.elements.code.addEventListener("input", () => fillProductFields(receiveForm));
receiveForm.addEventListener("submit", (event) => { event.preventDefault(); submitForm(receiveForm, "/api/receipts", "Đã nhập thêm hàng và cập nhật tồn kho."); });
const saleForm = $("#sale-form"); saleForm.dataset.buttonText = "Xác nhận xuất hàng";
saleForm.elements.code.addEventListener("input", () => fillProductFields(saleForm, true));
saleForm.addEventListener("submit", (event) => { event.preventDefault(); submitForm(saleForm, "/api/sales", "Đã xuất hàng và cập nhật tồn kho."); });

$("#product-search").addEventListener("input", (event) => { const term = event.target.value.trim().toLowerCase(); renderProducts(state.products.filter((product) => `${product.code} ${product.name}`.toLowerCase().includes(term))); });
const dialog = $("#settings-dialog");
$("#open-settings").addEventListener("click", () => { $("#api-token").value = localStorage.getItem("inventory-api-token") || ""; dialog.showModal(); });
$("#save-token").addEventListener("click", () => { localStorage.setItem("inventory-api-token", $("#api-token").value.trim()); setTimeout(refresh, 0); });
$("#today").textContent = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
const initialView = Object.prototype.hasOwnProperty.call(viewTitles, location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
showView(initialView); refresh();
