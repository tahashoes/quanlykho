import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DB_PATH || resolve("data", "quanlykho.db");
const publicDir = resolve("public");
const isProduction = process.env.NODE_ENV === "production";
const cookieSecure = process.env.COOKIE_SECURE === "true";
const sessionDays = 7;
const salesChannels = ["facebook", "zalo", "tiktok", "shopee", "website", "lazada"];

mkdirSync(dirname(dataFile), { recursive: true });
const db = new DatabaseSync(dataFile);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
    cost_price REAL NOT NULL CHECK(cost_price >= 0),
    sale_price REAL NOT NULL CHECK(sale_price >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    kind TEXT NOT NULL CHECK(kind IN ('IN', 'OUT')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price REAL NOT NULL CHECK(unit_price >= 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'manager')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_product_id ON transactions(product_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("products", "image_data", "TEXT");
ensureColumn("transactions", "sales_channel", "TEXT");
ensureColumn("transactions", "order_code", "TEXT");
ensureColumn("transactions", "operator_name", "TEXT");
ensureColumn("users", "display_name", "TEXT");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_order_code
  ON transactions(order_code)
  WHERE kind = 'OUT' AND order_code IS NOT NULL;
`);
db.prepare(`
  UPDATE users
  SET display_name = CASE
    WHEN role = 'admin' THEN 'Quản trị viên'
    ELSE 'Quản lý ' || phone
  END
  WHERE display_name IS NULL OR TRIM(display_name) = ''
`).run();

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return {
    salt,
    hash: scryptSync(password, salt, 64).toString("hex")
  };
}

function verifyPassword(password, salt, storedHash) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cleanText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new AppError(`${label} không được để trống.`);
  return text;
}

function cleanName(value) {
  const name = cleanText(value, "Tên người quản lý");
  if (name.length > 120) {
    throw new AppError("Tên người quản lý không được vượt quá 120 ký tự.");
  }
  return name;
}

function cleanOrderCode(value) {
  const orderCode = cleanText(value, "Mã đơn hàng").toUpperCase();
  if (orderCode.length > 64 || !/^[A-Z0-9._/-]+$/.test(orderCode)) {
    throw new AppError("Mã đơn hàng chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới hoặc dấu gạch chéo.");
  }
  return orderCode;
}

function cleanPhone(value) {
  const phone = String(value ?? "").replace(/[\s.-]/g, "");
  if (!/^\+?\d{8,15}$/.test(phone)) {
    throw new AppError("Số điện thoại phải có từ 8 đến 15 chữ số.");
  }
  return phone;
}

function cleanPassword(value, required = true) {
  const password = String(value ?? "");
  if (!password && !required) return "";
  if (password.length < 8) {
    throw new AppError("Mật khẩu phải có ít nhất 8 ký tự.");
  }
  return password;
}

function cleanManagerPhone(value) {
  const phone = String(value ?? "").replace(/\s/g, "");
  if (!/^0\d{9}$/.test(phone)) {
    throw new AppError("Số điện thoại quản lý phải gồm đúng 10 số và bắt đầu bằng số 0.");
  }
  return phone;
}

function cleanManagerPassword(value, required = true) {
  const password = String(value ?? "");
  if (!password && !required) return "";
  if (password.length < 6) {
    throw new AppError("Mật khẩu quản lý phải có ít nhất 6 ký tự.");
  }
  if (!/[^\p{L}\p{N}\s]/u.test(password)) {
    throw new AppError("Mật khẩu quản lý phải có ít nhất 1 ký tự đặc biệt.");
  }
  return password;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new AppError(`${label} phải là số nguyên lớn hơn 0.`);
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(`${label} phải là số không âm.`);
  }
  return number;
}

function cleanImage(value) {
  if (!value) return null;
  const image = String(value);
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(image)) {
    throw new AppError("Ảnh sản phẩm phải là JPEG, PNG hoặc WebP.");
  }
  if (image.length > 1_600_000) {
    throw new AppError("Ảnh sản phẩm sau xử lý không được vượt quá 1,2 MB.");
  }
  return image;
}

function cleanChannel(value) {
  const channel = String(value ?? "").trim().toLowerCase();
  if (!salesChannels.includes(channel)) {
    throw new AppError("Kênh bán hàng không hợp lệ.");
  }
  return channel;
}

function bootstrapAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return;

  const phone = process.env.ADMIN_PHONE || (isProduction ? "" : "0900000000");
  const password = process.env.ADMIN_PASSWORD || (isProduction ? "" : "Admin@123");
  if (!phone || !password) {
    throw new Error("Thiếu ADMIN_PHONE hoặc ADMIN_PASSWORD để tạo tài khoản admin đầu tiên.");
  }
  const cleanAdminPhone = cleanPhone(phone);
  const cleanAdminPassword = cleanPassword(password);
  const passwordData = hashPassword(cleanAdminPassword);
  const timestamp = now();
  db.prepare(`
    INSERT INTO users
      (display_name, phone, password_hash, password_salt, role, created_at, updated_at)
    VALUES ('Quản trị viên', ?, ?, ?, 'admin', ?, ?)
  `).run(cleanAdminPhone, passwordData.hash, passwordData.salt, timestamp, timestamp);

  if (!isProduction) {
    console.log("Tài khoản chạy thử: 0900000000 / Admin@123");
  }
}

bootstrapAdmin();
db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 3_000_000) throw new AppError("Dữ liệu gửi lên quá lớn.", 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError("Dữ liệu gửi lên không hợp lệ.");
  }
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const separator = item.indexOf("=");
        return separator < 0
          ? [item, ""]
          : [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
      })
  );
}

function sessionHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, maxAge) {
  return [
    `inventory_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    cookieSecure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function getCurrentUser(request) {
  const token = parseCookies(request).inventory_session;
  if (!token) return null;
  const tokenDigest = sessionHash(token);
  const session = db.prepare(`
    SELECT u.id, u.display_name, u.phone, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenDigest);
  if (!session) return null;
  if (session.expires_at <= now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenDigest);
    return null;
  }
  return {
    id: Number(session.id),
    name: session.display_name,
    phone: session.phone,
    role: session.role
  };
}

function requireUser(request) {
  const user = getCurrentUser(request);
  if (!user) throw new AppError("Phiên đăng nhập đã hết hạn.", 401);
  return user;
}

function requireAdmin(user) {
  if (user.role !== "admin") {
    throw new AppError("Chỉ admin được phép thực hiện thao tác này.", 403);
  }
}

function sendError(response, error) {
  if (error instanceof AppError) {
    return json(response, error.status, { error: error.message });
  }
  console.error(error);
  return json(response, 500, { error: "Có lỗi hệ thống xảy ra." });
}

function login(body, response) {
  const phone = cleanPhone(body.phone);
  const password = String(body.password ?? "");
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone);
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    throw new AppError("Số điện thoại hoặc mật khẩu không đúng.", 401);
  }
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(sessionHash(token), user.id, expiresAt, createdAt);
  return json(response, 200, {
    id: Number(user.id),
    name: user.display_name,
    phone: user.phone,
    role: user.role
  }, {
    "Set-Cookie": sessionCookie(token, sessionDays * 86_400)
  });
}

function logout(request, response) {
  const token = parseCookies(request).inventory_session;
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sessionHash(token));
  return json(response, 200, { ok: true }, {
    "Set-Cookie": sessionCookie("", 0)
  });
}

function getProductByCode(code) {
  return db.prepare("SELECT * FROM products WHERE code = ?").get(code);
}

function productView(product) {
  return {
    id: Number(product.id),
    code: product.code,
    name: product.name,
    stock: Number(product.stock),
    costPrice: Number(product.cost_price),
    salePrice: Number(product.sale_price),
    inventoryValue: Number(product.stock) * Number(product.cost_price),
    image: product.image_data || null,
    updatedAt: product.updated_at
  };
}

function dashboard() {
  const figures = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'OUT' THEN quantity * unit_price ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN kind = 'IN' THEN quantity * unit_price ELSE 0 END), 0) AS purchase_expense,
      COALESCE(SUM(CASE WHEN kind = 'OUT' THEN quantity * unit_cost ELSE 0 END), 0) AS cogs
    FROM transactions
  `).get();
  const inventory = db.prepare(`
    SELECT COUNT(*) AS sku_count, COALESCE(SUM(stock), 0) AS total_units,
           COALESCE(SUM(stock * cost_price), 0) AS inventory_value,
           COALESCE(SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END), 0) AS low_stock_count
    FROM products
  `).get();
  const recent = db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name,
           t.created_at, p.code, p.name
    FROM transactions t JOIN products p ON p.id = t.product_id
    ORDER BY t.id DESC LIMIT 8
  `).all();
  return {
    revenue: Number(figures.revenue),
    purchaseExpense: Number(figures.purchase_expense),
    cogs: Number(figures.cogs),
    profit: Number(figures.revenue) - Number(figures.cogs),
    skuCount: Number(inventory.sku_count),
    totalUnits: Number(inventory.total_units),
    inventoryValue: Number(inventory.inventory_value),
    lowStockCount: Number(inventory.low_stock_count),
    recent: recent.map(transactionView)
  };
}

function transactionView(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    unitCost: Number(row.unit_cost),
    channel: row.sales_channel || null,
    orderCode: row.order_code || null,
    operatorName: row.operator_name || null,
    createdAt: row.created_at,
    code: row.code,
    name: row.name
  };
}

function listProducts(search = "") {
  const term = `%${String(search).trim()}%`;
  return db.prepare(`
    SELECT * FROM products
    WHERE code LIKE ? OR name LIKE ?
    ORDER BY updated_at DESC, id DESC
  `).all(term, term).map(productView);
}

function listTransactions(limit = 500) {
  return db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name,
           t.created_at, p.code, p.name
    FROM transactions t JOIN products p ON p.id = t.product_id
    ORDER BY t.id DESC LIMIT ?
  `).all(limit).map(transactionView);
}

function addProduct(body, user) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const name = cleanText(body.name, "Tên sản phẩm");
  const quantity = positiveInteger(body.quantity, "Số lượng");
  const costPrice = nonNegativeNumber(body.costPrice, "Đơn giá nhập");
  const salePrice = nonNegativeNumber(body.salePrice, "Giá bán");
  const image = cleanImage(body.image);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (getProductByCode(code)) {
      throw new AppError("Mã sản phẩm đã tồn tại. Hãy dùng mục Nhập thêm hàng.");
    }
    const result = db.prepare(`
      INSERT INTO products
        (code, name, stock, cost_price, sale_price, image_data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(code, name, quantity, costPrice, salePrice, image, timestamp, timestamp);
    db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, operator_name, created_at)
      VALUES (?, 'IN', ?, ?, ?, NULL, ?, ?)
    `).run(Number(result.lastInsertRowid), quantity, costPrice, costPrice, user.name, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

function receiveStock(body, user) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const quantity = positiveInteger(body.quantity, "Số lượng nhập");
  const costPrice = nonNegativeNumber(body.costPrice, "Đơn giá nhập");
  const salePrice = body.salePrice === undefined || body.salePrice === ""
    ? undefined
    : nonNegativeNumber(body.salePrice, "Giá bán");
  const product = getProductByCode(code);
  if (!product) throw new AppError("Không tìm thấy sản phẩm theo mã này.", 404);
  const timestamp = now();
  const newStock = Number(product.stock) + quantity;
  const weightedCost = (
    (Number(product.stock) * Number(product.cost_price)) + (quantity * costPrice)
  ) / newStock;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE products SET stock = ?, cost_price = ?, sale_price = ?, updated_at = ?
      WHERE id = ?
    `).run(newStock, weightedCost, salePrice ?? Number(product.sale_price), timestamp, product.id);
    db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, operator_name, created_at)
      VALUES (?, 'IN', ?, ?, ?, NULL, ?, ?)
    `).run(product.id, quantity, costPrice, costPrice, user.name, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

function sellStock(body, user) {
  const orderCode = cleanOrderCode(body.orderCode);
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const quantity = positiveInteger(body.quantity, "Số lượng xuất");
  const salePrice = nonNegativeNumber(body.salePrice, "Giá bán");
  const channel = cleanChannel(body.channel);
  const product = getProductByCode(code);
  if (!product) throw new AppError("Không tìm thấy sản phẩm theo mã này.", 404);
  const existingOrder = db.prepare(`
    SELECT id FROM transactions WHERE kind = 'OUT' AND order_code = ?
  `).get(orderCode);
  if (existingOrder) throw new AppError("Mã đơn hàng này đã tồn tại.");
  if (Number(product.stock) < quantity) {
    throw new AppError(`Số lượng tồn không đủ. Hiện còn ${product.stock}.`);
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE products SET stock = stock - ?, sale_price = ?, updated_at = ? WHERE id = ?
    `).run(quantity, salePrice, timestamp, product.id);
    db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, order_code, operator_name, created_at)
      VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.id,
      quantity,
      salePrice,
      Number(product.cost_price),
      channel,
      orderCode,
      user.name,
      timestamp
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

function localDateText(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodRange(period, anchorValue) {
  if (!["day", "week", "month"].includes(period)) {
    throw new AppError("Khoảng thời gian báo cáo không hợp lệ.");
  }
  const anchorText = anchorValue || localDateText(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorText);
  if (!match) throw new AppError("Ngày báo cáo không hợp lệ.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const anchor = new Date(year, month - 1, day);
  if (
    anchor.getFullYear() !== year ||
    anchor.getMonth() !== month - 1 ||
    anchor.getDate() !== day
  ) {
    throw new AppError("Ngày báo cáo không hợp lệ.");
  }
  const start = new Date(anchor);
  if (period === "week") {
    const daysFromMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysFromMonday);
  } else if (period === "month") {
    start.setDate(1);
  }
  const end = new Date(start);
  if (period === "day") end.setDate(end.getDate() + 1);
  if (period === "week") end.setDate(end.getDate() + 7);
  if (period === "month") end.setMonth(end.getMonth() + 1);
  return {
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: localDateText(start),
    endDate: localDateText(new Date(end.getTime() - 1))
  };
}

function salesReport(period, anchor) {
  const range = periodRange(period, anchor);
  const rows = db.prepare(`
    SELECT COALESCE(sales_channel, 'unknown') AS channel,
           COUNT(*) AS orders,
           COALESCE(SUM(quantity), 0) AS units,
           COALESCE(SUM(quantity * unit_price), 0) AS revenue,
           COALESCE(SUM(quantity * unit_cost), 0) AS cogs
    FROM transactions
    WHERE kind = 'OUT' AND created_at >= ? AND created_at < ?
    GROUP BY COALESCE(sales_channel, 'unknown')
  `).all(range.start, range.end);
  const rowMap = new Map(rows.map((row) => [row.channel, row]));
  const availableChannels = [...salesChannels];
  if (rowMap.has("unknown")) availableChannels.push("unknown");
  const channels = availableChannels.map((channel) => {
    const row = rowMap.get(channel);
    const revenue = Number(row?.revenue || 0);
    const cogs = Number(row?.cogs || 0);
    return {
      channel,
      orders: Number(row?.orders || 0),
      units: Number(row?.units || 0),
      revenue,
      cogs,
      profit: revenue - cogs
    };
  });
  const totals = channels.reduce((result, item) => ({
    orders: result.orders + item.orders,
    units: result.units + item.units,
    revenue: result.revenue + item.revenue,
    cogs: result.cogs + item.cogs,
    profit: result.profit + item.profit
  }), { orders: 0, units: 0, revenue: 0, cogs: 0, profit: 0 });
  const transactions = db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name,
           t.created_at, p.code, p.name
    FROM transactions t JOIN products p ON p.id = t.product_id
    WHERE t.kind = 'OUT' AND t.created_at >= ? AND t.created_at < ?
    ORDER BY t.id DESC LIMIT 500
  `).all(range.start, range.end).map(transactionView);
  return { range, channels, totals, transactions };
}

function managerView(user) {
  return {
    id: Number(user.id),
    name: user.display_name,
    phone: user.phone,
    role: user.role,
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function listManagers() {
  return db.prepare(`
    SELECT id, display_name, phone, role, created_at, updated_at
    FROM users WHERE role = 'manager' ORDER BY id DESC
  `).all().map(managerView);
}

function createManager(body) {
  const managerCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'manager'").get().count
  );
  if (managerCount >= 5) {
    throw new AppError("Đã đạt giới hạn tối đa 5 tài khoản quản lý.");
  }
  const name = cleanName(body.name);
  const phone = cleanManagerPhone(body.phone);
  const password = cleanManagerPassword(body.password);
  const passwordData = hashPassword(password);
  const timestamp = now();
  try {
    const result = db.prepare(`
      INSERT INTO users
        (display_name, phone, password_hash, password_salt, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'manager', ?, ?)
    `).run(name, phone, passwordData.hash, passwordData.salt, timestamp, timestamp);
    return managerView(db.prepare(`
      SELECT id, display_name, phone, role, created_at, updated_at FROM users WHERE id = ?
    `).get(Number(result.lastInsertRowid)));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      throw new AppError("Số điện thoại này đã được sử dụng.");
    }
    throw error;
  }
}

function updateManager(id, body) {
  const current = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'manager'").get(id);
  if (!current) throw new AppError("Không tìm thấy tài khoản quản lý.", 404);
  const name = cleanName(body.name);
  const phone = cleanManagerPhone(body.phone);
  const password = cleanManagerPassword(body.password, false);
  const timestamp = now();
  try {
    if (password) {
      const passwordData = hashPassword(password);
      db.prepare(`
        UPDATE users
        SET display_name = ?, phone = ?, password_hash = ?, password_salt = ?, updated_at = ?
        WHERE id = ? AND role = 'manager'
      `).run(name, phone, passwordData.hash, passwordData.salt, timestamp, id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    } else {
      db.prepare(`
        UPDATE users SET display_name = ?, phone = ?, updated_at = ?
        WHERE id = ? AND role = 'manager'
      `).run(name, phone, timestamp, id);
    }
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      throw new AppError("Số điện thoại này đã được sử dụng.");
    }
    throw error;
  }
  return managerView(db.prepare(`
    SELECT id, display_name, phone, role, created_at, updated_at FROM users WHERE id = ?
  `).get(id));
}

function deleteManager(id) {
  const manager = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager'").get(id);
  if (!manager) throw new AppError("Không tìm thấy tài khoản quản lý.", 404);
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'manager'").run(id);
  return { ok: true };
}

function routeId(pathname, prefix) {
  const match = new RegExp(`^${prefix}/(\\d+)$`).exec(pathname);
  return match ? Number(match[1]) : null;
}

async function serveStatic(response, url) {
  const requested = url.pathname === "/" ? "index.html" : basename(url.pathname);
  const filePath = resolve(publicDir, requested);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Không tìm thấy trang.");
    return;
  }
  const file = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream"
  });
  response.end(file);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (!url.pathname.startsWith("/api/")) {
      return await serveStatic(response, url);
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      return login(await readJson(request), response);
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      return logout(request, response);
    }

    const user = requireUser(request);
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      return json(response, 200, user);
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      return json(response, 200, dashboard());
    }
    if (request.method === "GET" && url.pathname === "/api/products") {
      return json(response, 200, listProducts(url.searchParams.get("q") || ""));
    }
    if (request.method === "GET" && url.pathname === "/api/transactions") {
      return json(response, 200, listTransactions());
    }
    if (request.method === "GET" && url.pathname === "/api/reports") {
      return json(
        response,
        200,
        salesReport(url.searchParams.get("period") || "day", url.searchParams.get("anchor"))
      );
    }
    if (request.method === "POST" && url.pathname === "/api/products") {
      return json(response, 201, addProduct(await readJson(request), user));
    }
    if (request.method === "POST" && url.pathname === "/api/receipts") {
      return json(response, 201, receiveStock(await readJson(request), user));
    }
    if (request.method === "POST" && url.pathname === "/api/sales") {
      return json(response, 201, sellStock(await readJson(request), user));
    }
    if (url.pathname === "/api/managers") {
      requireAdmin(user);
      if (request.method === "GET") return json(response, 200, listManagers());
      if (request.method === "POST") {
        return json(response, 201, createManager(await readJson(request)));
      }
    }
    const managerId = routeId(url.pathname, "/api/managers");
    if (managerId !== null) {
      requireAdmin(user);
      if (request.method === "PUT") {
        return json(response, 200, updateManager(managerId, await readJson(request)));
      }
      if (request.method === "DELETE") {
        return json(response, 200, deleteManager(managerId));
      }
    }
    return json(response, 404, { error: "Không tìm thấy API." });
  } catch (error) {
    return sendError(response, error);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`QuanLyKho is running at http://0.0.0.0:${port}`);
});

function shutDown() {
  db.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
