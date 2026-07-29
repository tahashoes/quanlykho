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
  products: [],
  dashboard: null,
  report: null,
  managers: [],
  reportPeriod: "day",
  reportAnchor: localDateValue(),
  productImage: null,
  editingManagerId: null
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

function metric(label, value, note, accent = false) {
  return `<article class="metric${accent ? " teal" : ""}"><span class="metric-label">${text(label)}</span><strong>${text(value)}</strong><small>${text(note)}</small></article>`;
}

function showLogin() {
  state.currentUser = null;
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  $("#login-form").elements.password.value = "";
}

function showApp(user) {
  state.currentUser = user;
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#current-phone").textContent = user.phone;
  $("#current-role").textContent = user.role === "admin" ? "Quản trị viên" : "Quản lý";
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
        : `Xuất hàng · ${channelLabels[item.channel] || "Chưa xác định"}`;
      return `<div class="compact-row"><span class="row-icon ${item.kind === "OUT" ? "out" : ""}">${item.kind === "IN" ? "+" : "−"}</span><div class="row-copy"><strong>${text(item.name)}</strong><small>${details} · ${dateTime.format(new Date(item.createdAt))}</small></div><div class="row-value">${item.kind === "IN" ? "+" : "−"}${item.quantity}<small>${money.format(item.quantity * item.unitPrice)}</small></div></div>`;
    }).join("")
    : `<p class="empty">Chưa có giao dịch nào.</p>`;
}

function renderProductOptions() {
  $("#product-codes").innerHTML = state.products
    .map((product) => `<option value="${text(product.code)}">${text(product.name)}</option>`)
    .join("");
}

function renderProducts(products = state.products) {
  $("#product-table").innerHTML = products.length
    ? products.map((product) => {
      const visual = product.image
        ? `<img class="product-thumb" src="${product.image}" alt="" />`
        : `<span class="product-placeholder">${text(product.name.slice(0, 1).toUpperCase())}</span>`;
      return `<tr><td><div class="product-cell">${visual}<span class="product-name">${text(product.name)}</span></div></td><td>${text(product.code)}</td><td><span class="stock${product.stock <= 5 ? " low" : ""}">${product.stock}</span></td><td>${money.format(product.costPrice)}</td><td>${money.format(product.salePrice)}</td><td>${money.format(product.inventoryValue)}</td><td class="muted">${dateTime.format(new Date(product.updatedAt))}</td></tr>`;
    }).join("")
    : `<tr><td colspan="7" class="empty">Chưa tìm thấy sản phẩm.</td></tr>`;
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
    metric("Số đơn hàng", report.totals.orders.toLocaleString("vi-VN"), "Mỗi lần xuất là một đơn"),
    metric("Sản phẩm bán ra", report.totals.units.toLocaleString("vi-VN"), "Tổng số lượng trong các đơn")
  ].join("");
  const channelRows = report.channels.map((item) => `<tr><td><span class="channel-chip">${text(channelLabels[item.channel] || item.channel)}</span></td><td>${item.orders.toLocaleString("vi-VN")}</td><td>${item.units.toLocaleString("vi-VN")}</td><td>${money.format(item.revenue)}</td><td>${money.format(item.profit)}</td></tr>`).join("");
  $("#channel-table").innerHTML = `${channelRows}<tr class="channel-total"><td>TỔNG TẤT CẢ KÊNH</td><td>${report.totals.orders.toLocaleString("vi-VN")}</td><td>${report.totals.units.toLocaleString("vi-VN")}</td><td>${money.format(report.totals.revenue)}</td><td>${money.format(report.totals.profit)}</td></tr>`;
  $("#transaction-table").innerHTML = report.transactions.length
    ? report.transactions.map((item) => `<tr><td class="muted">${dateTime.format(new Date(item.createdAt))}</td><td><span class="channel-chip">${text(channelLabels[item.channel] || "Chưa xác định")}</span></td><td>${text(item.code)}</td><td class="product-name">${text(item.name)}</td><td>${item.quantity}</td><td>${money.format(item.unitPrice)}</td><td>${money.format(item.quantity * item.unitPrice)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="empty">Không có đơn hàng trong khoảng thời gian này.</td></tr>`;
}

function renderManagers() {
  $("#manager-limit").textContent = `${state.managers.length}/5`;
  $("#manager-table").innerHTML = state.managers.length
    ? state.managers.map((manager) => `<tr><td class="product-name">${text(manager.phone)}</td><td><span class="role-chip">Quản lý</span></td><td class="muted">${dateTime.format(new Date(manager.createdAt))}</td><td class="muted">${dateTime.format(new Date(manager.updatedAt))}</td><td><div class="action-buttons"><button class="mini-button" data-manager-action="edit" data-id="${manager.id}">Sửa</button><button class="mini-button danger" data-manager-action="delete" data-id="${manager.id}">Xóa</button></div></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">Chưa có tài khoản quản lý.</td></tr>`;
}

function findProduct(code) {
  return state.products.find(
    (product) => product.code.toLowerCase() === String(code).trim().toLowerCase()
  );
}

function fillProductFields(form, showStock = false) {
  const product = findProduct(form.elements.code.value);
  form.elements.name.value = product ? product.name : "";
  if (product && form.elements.salePrice && !form.elements.salePrice.value) {
    form.elements.salePrice.value = product.salePrice;
  }
  if (showStock) {
    $("#sale-stock-hint").textContent = product
      ? `Hiện còn ${product.stock} đơn vị · giá bán gợi ý ${money.format(product.salePrice)}.`
      : "Không tìm thấy sản phẩm theo mã đã nhập.";
  }
}

function formData(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  delete values.imageFile;
  return values;
}

async function refreshCore() {
  const requests = [api("/api/dashboard"), api("/api/products")];
  if (state.currentUser?.role === "admin") requests.push(api("/api/managers"));
  const [dashboard, products, managers = []] = await Promise.all(requests);
  state.dashboard = dashboard;
  state.products = products;
  state.managers = managers;
  renderDashboard();
  renderProductOptions();
  renderProducts();
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
    if (form.id === "sale-form") {
      $("#sale-stock-hint").textContent = "Chọn mã sản phẩm để xem số lượng tồn.";
    }
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
  $("#manager-password-note").textContent = "(tối thiểu 8 ký tự)";
  form.querySelector("button[type=submit]").textContent = "Thêm quản lý";
  $("#cancel-manager-edit").classList.add("hidden");
}

function startManagerEdit(id) {
  const manager = state.managers.find((item) => item.id === id);
  if (!manager) return;
  state.editingManagerId = id;
  const form = $("#manager-form");
  form.elements.phone.value = manager.phone;
  form.elements.password.value = "";
  form.elements.password.required = false;
  $("#manager-form-title").textContent = "Sửa tài khoản quản lý";
  $("#manager-password-note").textContent = "(để trống nếu giữ mật khẩu cũ)";
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

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
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

const receiveForm = $("#receive-form");
receiveForm.elements.code.addEventListener("input", () => fillProductFields(receiveForm));
receiveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(receiveForm, "/api/receipts", "Đã nhập thêm hàng và cập nhật tồn kho.");
});

const saleForm = $("#sale-form");
saleForm.elements.code.addEventListener("input", () => fillProductFields(saleForm, true));
saleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitForm(saleForm, "/api/sales", "Đã xuất hàng và ghi nhận kênh bán.");
});

$("#product-search").addEventListener("input", (event) => {
  const term = event.target.value.trim().toLowerCase();
  renderProducts(
    state.products.filter((product) => `${product.code} ${product.name}`.toLowerCase().includes(term))
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
  const editing = state.editingManagerId;
  const saved = await submitForm(
    event.currentTarget,
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
  if (!manager || !window.confirm(`Xóa tài khoản quản lý ${manager.phone}?`)) return;
  try {
    await api(`/api/managers/${id}`, { method: "DELETE", body: "{}" });
    if (state.editingManagerId === id) resetManagerForm();
    await refreshCore();
    toast("Đã xóa tài khoản quản lý.");
  } catch (error) {
    toast(error.message, "error");
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
