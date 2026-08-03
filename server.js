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
const productUnits = ["đôi", "cái", "chai", "thùng", "cuộn", "tờ", "sấp"];
const orderStatuses = ["pending_pickup", "shipping", "completed", "returned", "cancelled"];
const terminalOrderStatuses = new Set(["returned", "cancelled"]);
const saleCategoryNames = new Set(["Giày", "Xịt khử mùi"]);
const shoeBundleRules = [
  { categoryName: "Vớ", quantity: 1, unit: "đôi", price: 9_000, perOrder: false },
  { categoryName: "Xịt khử mùi", quantity: 1, unit: "chai", price: 10_000, perOrder: false },
  { categoryName: "Thùng Carton", quantity: 1, unit: "thùng", price: 8_000, perOrder: false },
  { categoryName: "Băng keo", quantity: 1, unit: "cuộn", price: 1_000, perOrder: false },
  { categoryName: "Giấy in", quantity: 1, unit: "tờ", price: 200, perOrder: true }
];
const defaultCategories = [
  { name: "Giày", requiresSize: true, priceNote: "Đã bao gồm VAT 8%" },
  { name: "Vớ", requiresSize: true, priceNote: "Đã bao gồm VAT 8%" },
  { name: "Xịt khử mùi", requiresSize: false, priceNote: "Đã bao gồm PVC" },
  { name: "Thùng Carton", requiresSize: false, priceNote: "Đã bao gồm PVC" },
  { name: "Băng keo", requiresSize: false, priceNote: "Đã bao gồm PVC" },
  { name: "Giấy in", requiresSize: false, priceNote: "Đã bao gồm PVC" }
];

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
ensureColumn("products", "shipping_cost", "REAL NOT NULL DEFAULT 0");
ensureColumn("transactions", "sales_channel", "TEXT");
ensureColumn("transactions", "order_code", "TEXT");
ensureColumn("transactions", "operator_name", "TEXT");
ensureColumn("transactions", "discount_type", "TEXT");
ensureColumn("transactions", "discount_value", "REAL NOT NULL DEFAULT 0");
ensureColumn("transactions", "line_role", "TEXT NOT NULL DEFAULT 'main'");
ensureColumn("users", "display_name", "TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    requires_size INTEGER NOT NULL DEFAULT 0 CHECK(requires_size IN (0, 1)),
    price_note TEXT NOT NULL DEFAULT 'Đã bao gồm thuế/phí theo hóa đơn',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY,
    order_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sales_channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_pickup'
      CHECK(status IN ('pending_pickup', 'shipping', 'completed', 'returned', 'cancelled')),
    platform_fee REAL NOT NULL DEFAULT 0 CHECK(platform_fee >= 0),
    operator_name TEXT,
    stock_restored_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    previous_stock INTEGER NOT NULL CHECK(previous_stock >= 0),
    new_stock INTEGER NOT NULL CHECK(new_stock >= 0),
    operator_name TEXT,
    created_at TEXT NOT NULL
  );
`);
ensureColumn("products", "category_id", "INTEGER");
ensureColumn("products", "size", "TEXT");
ensureColumn("products", "color", "TEXT");
ensureColumn("products", "unit", "TEXT NOT NULL DEFAULT 'cái'");
const insertDefaultCategory = db.prepare(`
  INSERT OR IGNORE INTO categories (name, requires_size, price_note, created_at)
  VALUES (?, ?, ?, ?)
`);
for (const category of defaultCategories) {
  insertDefaultCategory.run(
    category.name,
    category.requiresSize ? 1 : 0,
    category.priceNote,
    now()
  );
}
db.prepare(`
  UPDATE products
  SET category_id = (
    SELECT id FROM categories
    WHERE name = CASE
      WHEN LOWER(products.name) LIKE '%vớ%' THEN 'Vớ'
      WHEN LOWER(products.name) LIKE '%xịt%' THEN 'Xịt khử mùi'
      WHEN LOWER(products.name) LIKE '%carton%' OR LOWER(products.name) LIKE '%thùng%' THEN 'Thùng Carton'
      WHEN LOWER(products.name) LIKE '%băng keo%' OR LOWER(products.name) LIKE '%keo%' THEN 'Băng keo'
      WHEN LOWER(products.name) LIKE '%giấy%' THEN 'Giấy in'
      ELSE 'Giày'
    END
  )
  WHERE category_id IS NULL
`).run();
db.exec(`
  DROP INDEX IF EXISTS idx_transactions_order_code;
  CREATE INDEX idx_transactions_order_code ON transactions(order_code);
  CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_created_at ON sales_orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id ON stock_adjustments(product_id);
`);
db.prepare(`
  INSERT OR IGNORE INTO sales_orders
    (order_code, sales_channel, status, platform_fee, operator_name, created_at, updated_at)
  SELECT order_code,
         COALESCE(MAX(sales_channel), 'unknown'),
         'completed',
         0,
         MAX(operator_name),
         MIN(created_at),
         MAX(created_at)
  FROM transactions
  WHERE kind = 'OUT' AND order_code IS NOT NULL AND TRIM(order_code) <> ''
  GROUP BY order_code
`).run();
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
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
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

function cleanOptionalText(value, label, maximum = 120) {
  const result = String(value ?? "").trim();
  if (result.length > maximum) {
    throw new AppError(`${label} không được vượt quá ${maximum} ký tự.`);
  }
  return result || null;
}

function cleanCategoryName(value) {
  const name = cleanText(value, "Tên danh mục");
  if (name.length > 80) {
    throw new AppError("Tên danh mục không được vượt quá 80 ký tự.");
  }
  return name;
}

function cleanUnit(value) {
  const unit = String(value ?? "").trim().toLowerCase();
  if (!productUnits.includes(unit)) {
    throw new AppError("Đơn vị hàng hóa không hợp lệ.");
  }
  return unit;
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
  const number = numericValue(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new AppError(`${label} phải là số nguyên lớn hơn 0.`);
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = numericValue(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(`${label} phải là số không âm.`);
  }
  return number;
}

function numericValue(value) {
  if (typeof value === "string") {
    return Number(value.replaceAll(",", "").replace(/\s/g, ""));
  }
  return Number(value);
}

function nonNegativeInteger(value, label) {
  const number = numericValue(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new AppError(`${label} phải là số nguyên không âm.`);
  }
  return number;
}

function cleanOrderStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  if (!orderStatuses.includes(status)) {
    throw new AppError("Trạng thái đơn hàng không hợp lệ.");
  }
  return status;
}

function landedCost(product) {
  return Number(product.cost_price) + Number(product.shipping_cost || 0);
}

function normalizeStockInput(category, unitValue, quantityValue, costValue, shippingValue = 0) {
  const unit = cleanUnit(unitValue);
  const quantity = positiveInteger(quantityValue, "Số lượng nhập");
  const costPrice = nonNegativeNumber(costValue, "Giá nhập");
  const shippingCost = nonNegativeNumber(shippingValue || 0, "Phí vận chuyển");
  if (category.name === "Giấy in" && unit === "sấp") {
    return {
      quantity: quantity * 500,
      unit: "tờ",
      costPrice: costPrice / 500,
      shippingCost: shippingCost / 500
    };
  }
  return { quantity, unit, costPrice, shippingCost };
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

function cleanDiscount(typeValue, valueValue, salePrice) {
  const value = valueValue === undefined || valueValue === ""
    ? 0
    : nonNegativeNumber(valueValue, "Giá trị giảm giá");
  if (value === 0) return { type: null, value: 0 };
  const type = String(typeValue ?? "").trim().toLowerCase();
  if (!["percent", "amount"].includes(type)) {
    throw new AppError("Hình thức giảm giá không hợp lệ.");
  }
  if (type === "percent" && value > 100) {
    throw new AppError("Giảm giá phần trăm không được vượt quá 100%.");
  }
  if (type === "amount" && value > salePrice) {
    throw new AppError("Số tiền giảm trên mỗi sản phẩm không được lớn hơn giá bán.");
  }
  return { type, value };
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

function categoryView(category) {
  return {
    id: Number(category.id),
    name: category.name,
    requiresSize: Boolean(category.requires_size),
    priceNote: category.price_note,
    createdAt: category.created_at
  };
}

function listCategories() {
  return db.prepare(`
    SELECT id, name, requires_size, price_note, created_at
    FROM categories
    ORDER BY id ASC
  `).all().map(categoryView);
}

function addCategory(body) {
  const name = cleanCategoryName(body.name);
  const requiresSize = body.requiresSize === true || body.requiresSize === "true" ? 1 : 0;
  const priceNote = requiresSize
    ? "Đã bao gồm VAT 8%"
    : "Đã bao gồm thuế/phí theo hóa đơn";
  try {
    const result = db.prepare(`
      INSERT INTO categories (name, requires_size, price_note, created_at)
      VALUES (?, ?, ?, ?)
    `).run(name, requiresSize, priceNote, now());
    return categoryView(db.prepare("SELECT * FROM categories WHERE id = ?").get(
      Number(result.lastInsertRowid)
    ));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      throw new AppError("Danh mục này đã tồn tại.");
    }
    throw error;
  }
}

function getCategoryById(id) {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
}

function getProductByCode(code) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name, c.requires_size, c.price_note
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.code = ?
  `).get(code);
}

function productView(product) {
  const shippingCost = Number(product.shipping_cost || 0);
  const productLandedCost = Number(product.cost_price) + shippingCost;
  return {
    id: Number(product.id),
    code: product.code,
    name: product.name,
    stock: Number(product.stock),
    costPrice: Number(product.cost_price),
    shippingCost,
    landedCost: productLandedCost,
    salePrice: Number(product.sale_price),
    inventoryValue: Number(product.stock) * productLandedCost,
    categoryId: product.category_id ? Number(product.category_id) : null,
    categoryName: product.category_name || "Chưa phân loại",
    requiresSize: Boolean(product.requires_size),
    priceNote: product.price_note || "",
    size: product.size || null,
    color: product.color || null,
    unit: product.unit || "cái",
    image: product.image_data || null,
    updatedAt: product.updated_at
  };
}

function dashboard() {
  const figures = db.prepare(`
    SELECT
      COALESCE(SUM(CASE
        WHEN t.kind = 'OUT'
          AND t.line_role = 'main'
          AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
        THEN t.quantity * CASE
          WHEN t.discount_type = 'percent' THEN t.unit_price * (1 - t.discount_value / 100.0)
          WHEN t.discount_type = 'amount' THEN MAX(0, t.unit_price - t.discount_value)
          ELSE t.unit_price
        END
        ELSE 0
      END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN t.kind = 'IN' THEN t.quantity * t.unit_cost ELSE 0 END), 0)
        AS purchase_expense,
      COALESCE(SUM(CASE
        WHEN t.kind = 'OUT' AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
        THEN t.quantity * t.unit_cost ELSE 0 END), 0) AS cogs
    FROM transactions t
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
  `).get();
  const platformFees = Number(db.prepare(`
    SELECT COALESCE(SUM(platform_fee), 0) AS total
    FROM sales_orders
    WHERE status NOT IN ('returned', 'cancelled')
  `).get().total);
  const inventory = db.prepare(`
    SELECT COUNT(*) AS sku_count, COALESCE(SUM(stock), 0) AS total_units,
           COALESCE(SUM(stock * (cost_price + COALESCE(shipping_cost, 0))), 0)
             AS inventory_value,
           COALESCE(SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END), 0) AS low_stock_count
    FROM products
  `).get();
  const recent = db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name, t.discount_type, t.discount_value, t.line_role,
           so.status AS order_status, so.platform_fee,
           t.created_at, p.code, p.name, p.category_id, p.size, p.color, p.unit,
           c.name AS category_name
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    ORDER BY t.id DESC LIMIT 8
  `).all();
  const channelRanking = db.prepare(`
    SELECT COALESCE(t.sales_channel, 'unknown') AS channel,
           COUNT(DISTINCT COALESCE(t.order_code, 'LEGACY-' || t.id)) AS orders,
           COALESCE(SUM(t.quantity), 0) AS units
    FROM transactions t
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    WHERE t.kind = 'OUT' AND t.line_role = 'main'
      AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
      AND t.sales_channel IN ('facebook', 'zalo', 'tiktok', 'shopee', 'website', 'lazada')
    GROUP BY COALESCE(t.sales_channel, 'unknown')
    ORDER BY orders DESC, units DESC, channel ASC
  `).all().map((row) => ({
    channel: row.channel,
    orders: Number(row.orders),
    units: Number(row.units)
  }));
  const productSalesRanking = db.prepare(`
    SELECT p.code, p.name,
           COUNT(DISTINCT COALESCE(t.order_code, 'LEGACY-' || t.id)) AS orders,
           COALESCE(SUM(t.quantity), 0) AS units
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    WHERE t.kind = 'OUT' AND t.line_role = 'main'
      AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
    GROUP BY t.product_id, p.code, p.name
    ORDER BY units DESC, orders DESC, p.name ASC
    LIMIT 5
  `).all().map((row) => ({
    code: row.code,
    name: row.name,
    orders: Number(row.orders),
    units: Number(row.units)
  }));
  const inventoryRanking = db.prepare(`
    SELECT code, name, stock
    FROM products
    WHERE stock > 0
    ORDER BY stock DESC, name ASC
    LIMIT 5
  `).all().map((row) => ({
    code: row.code,
    name: row.name,
    stock: Number(row.stock)
  }));
  return {
    revenue: Number(figures.revenue),
    purchaseExpense: Number(figures.purchase_expense),
    cogs: Number(figures.cogs),
    platformFees,
    profit: Number(figures.revenue) - platformFees - Number(figures.cogs),
    skuCount: Number(inventory.sku_count),
    totalUnits: Number(inventory.total_units),
    inventoryValue: Number(inventory.inventory_value),
    lowStockCount: Number(inventory.low_stock_count),
    recent: recent.map(transactionView),
    rankings: {
      channels: channelRanking,
      soldProducts: productSalesRanking,
      inventoryProducts: inventoryRanking
    }
  };
}

function transactionView(row) {
  const quantity = Number(row.quantity);
  const unitPrice = Number(row.unit_price);
  const discountValue = Number(row.discount_value || 0);
  const discountType = row.discount_type || null;
  const grossTotal = quantity * unitPrice;
  const discountTotal = discountType === "percent"
    ? grossTotal * discountValue / 100
    : discountType === "amount"
      ? quantity * discountValue
      : 0;
  return {
    id: Number(row.id),
    kind: row.kind,
    quantity,
    unitPrice,
    unitCost: Number(row.unit_cost),
    discountType,
    discountValue,
    grossTotal,
    discountTotal,
    total: Math.max(0, grossTotal - discountTotal),
    lineRole: row.line_role || "main",
    channel: row.sales_channel || null,
    orderCode: row.order_code || null,
    orderStatus: row.order_status || null,
    platformFee: Number(row.platform_fee || 0),
    operatorName: row.operator_name || null,
    createdAt: row.created_at,
    code: row.code,
    name: row.name,
    categoryId: row.category_id ? Number(row.category_id) : null,
    categoryName: row.category_name || "Chưa phân loại",
    size: row.size || null,
    color: row.color || null,
    unit: row.unit || "cái"
  };
}

function listProducts(search = "") {
  const term = `%${String(search).trim()}%`;
  return db.prepare(`
    SELECT p.*, c.name AS category_name, c.requires_size, c.price_note
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.code LIKE ? OR p.name LIKE ? OR c.name LIKE ?
       OR COALESCE(p.size, '') LIKE ? OR COALESCE(p.color, '') LIKE ?
    ORDER BY p.updated_at DESC, p.id DESC
  `).all(term, term, term, term, term).map(productView);
}

function listTransactions(limit = 500) {
  return db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name, t.discount_type, t.discount_value, t.line_role,
           so.status AS order_status, so.platform_fee,
           t.created_at, p.code, p.name, p.category_id, p.size, p.color, p.unit,
           c.name AS category_name
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    ORDER BY t.id DESC LIMIT ?
  `).all(limit).map(transactionView);
}

function addProduct(body, user) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const categoryId = positiveInteger(body.categoryId, "Danh mục hàng hóa");
  const category = getCategoryById(categoryId);
  if (!category) throw new AppError("Không tìm thấy danh mục hàng hóa.", 404);
  const name = cleanOptionalText(body.name, "Tên hàng hóa", 160) || code;
  const size = cleanOptionalText(body.size, "Size", 50);
  if (category.requires_size && !size) {
    throw new AppError(`Danh mục ${category.name} bắt buộc phải nhập size.`);
  }
  const color = cleanOptionalText(body.color, "Màu sắc", 80);
  const stockInput = normalizeStockInput(
    category,
    body.unit,
    body.quantity,
    body.costPrice,
    body.shippingCost
  );
  const { unit, quantity, costPrice, shippingCost } = stockInput;
  const salePrice = body.salePrice === undefined || body.salePrice === ""
    ? 0
    : nonNegativeNumber(body.salePrice, "Giá bán");
  const image = cleanImage(body.image);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (getProductByCode(code)) {
      throw new AppError("Mã sản phẩm đã tồn tại. Hãy dùng mục Nhập thêm hàng.");
    }
    const result = db.prepare(`
      INSERT INTO products
        (code, name, stock, cost_price, shipping_cost, sale_price, image_data, category_id,
         size, color, unit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      name,
      quantity,
      costPrice,
      shippingCost,
      salePrice,
      image,
      categoryId,
      size,
      color,
      unit,
      timestamp,
      timestamp
    );
    db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, operator_name, created_at)
      VALUES (?, 'IN', ?, ?, ?, NULL, ?, ?)
    `).run(
      Number(result.lastInsertRowid),
      quantity,
      costPrice,
      costPrice + shippingCost,
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

function receiveStock(body, user) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const product = getProductByCode(code);
  if (!product) throw new AppError("Không tìm thấy sản phẩm theo mã này.", 404);
  const category = getCategoryById(product.category_id);
  const stockInput = normalizeStockInput(
    category,
    body.inputUnit || product.unit,
    body.quantity,
    body.costPrice,
    body.shippingCost
  );
  const { quantity, costPrice, shippingCost } = stockInput;
  const salePrice = body.salePrice === undefined || body.salePrice === ""
    ? undefined
    : nonNegativeNumber(body.salePrice, "Giá bán");
  const timestamp = now();
  const newStock = Number(product.stock) + quantity;
  const weightedCost = (
    (Number(product.stock) * Number(product.cost_price)) + (quantity * costPrice)
  ) / newStock;
  const weightedShipping = (
    (Number(product.stock) * Number(product.shipping_cost || 0)) + (quantity * shippingCost)
  ) / newStock;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE products
      SET stock = ?, cost_price = ?, shipping_cost = ?, sale_price = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newStock,
      weightedCost,
      weightedShipping,
      salePrice ?? Number(product.sale_price),
      timestamp,
      product.id
    );
    db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, operator_name, created_at)
      VALUES (?, 'IN', ?, ?, ?, NULL, ?, ?)
    `).run(
      product.id,
      quantity,
      costPrice,
      costPrice + shippingCost,
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

function adjustStock(id, body, user) {
  const product = db.prepare("SELECT id, code, stock FROM products WHERE id = ?").get(id);
  if (!product) throw new AppError("Không tìm thấy sản phẩm.", 404);
  const newStock = nonNegativeInteger(body.stock, "Số lượng tồn");
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?")
      .run(newStock, timestamp, id);
    db.prepare(`
      INSERT INTO stock_adjustments
        (product_id, previous_stock, new_stock, operator_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, Number(product.stock), newStock, user.name, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(product.code));
}

function getBundleProduct(categoryName) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name, c.requires_size, c.price_note
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE c.name = ? AND p.stock > 0
    ORDER BY p.stock DESC, p.id ASC
    LIMIT 1
  `).get(categoryName);
}

function salesConfigView() {
  const allowedCategories = listCategories().filter((category) => (
    saleCategoryNames.has(category.name)
  ));
  const addons = shoeBundleRules.map((rule) => {
    const product = getBundleProduct(rule.categoryName);
    return {
      ...rule,
      product: product ? productView(product) : null
    };
  });
  return {
    allowedCategories,
    addons,
    paperConversion: { purchaseUnit: "sấp", baseUnit: "tờ", quantity: 500 }
  };
}

function vietnamOrderDate(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => (
      [part.type, part.value]
    ))
  );
  return `${parts.day}${parts.month}${parts.year}`;
}

function nextOrderCodeInfo(reservedCodes = new Set()) {
  const date = vietnamOrderDate();
  const prefix = `TAHA-${date}-`;
  const rows = db.prepare(`
    SELECT order_code FROM sales_orders WHERE order_code LIKE ?
  `).all(`${prefix}%`);
  let sequence = rows.reduce((maximum, row) => {
    const match = new RegExp(`^${prefix}(\\d+)$`, "i").exec(row.order_code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  let code = `${prefix}${String(sequence).padStart(3, "0")}`;
  while (reservedCodes.has(code)) {
    sequence += 1;
    code = `${prefix}${String(sequence).padStart(3, "0")}`;
  }
  return { code, date, sequence };
}

function sellStock(body, user) {
  const channel = cleanChannel(body.channel);
  const rawOrders = Array.isArray(body.orders)
    ? body.orders
    : [{
      orderCode: body.orderCode,
      platformFee: body.platformFee,
      items: [{
        code: body.code,
        quantity: body.quantity,
        salePrice: body.salePrice,
        discountType: body.discountType,
        discountValue: body.discountValue
      }]
    }];
  if (rawOrders.length === 0) {
    throw new AppError("Cần có ít nhất một đơn hàng.");
  }
  if (rawOrders.length > 20) {
    throw new AppError("Mỗi lần chỉ được xuất tối đa 20 đơn hàng.");
  }

  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const orderCodes = new Set();
    const productCache = new Map();
    const bundleProductCache = new Map();
    const stockRequirements = new Map();
    const preparedOrders = [];
    const preparedLines = [];

    const addStockRequirement = (product, quantity, salePrice) => {
      const requirement = stockRequirements.get(product.id) || {
        product,
        quantity: 0,
        salePrice: null
      };
      requirement.quantity += quantity;
      if (salePrice !== null) requirement.salePrice = salePrice;
      stockRequirements.set(product.id, requirement);
    };

    for (const [orderIndex, rawOrder] of rawOrders.entries()) {
      const generatedCode = nextOrderCodeInfo(orderCodes).code;
      const orderCode = cleanOrderCode(rawOrder?.orderCode || generatedCode);
      if (orderCodes.has(orderCode)) {
        throw new AppError(`Mã đơn ${orderCode} đang bị nhập trùng trong đợt xuất.`);
      }
      orderCodes.add(orderCode);
      const existingOrder = db.prepare(
        "SELECT id FROM sales_orders WHERE order_code = ? LIMIT 1"
      ).get(orderCode);
      if (existingOrder) throw new AppError(`Mã đơn hàng ${orderCode} đã tồn tại.`);

      const rawItems = Array.isArray(rawOrder?.items) ? rawOrder.items : [];
      if (rawItems.length === 0) {
        throw new AppError(`Đơn ${orderCode} cần có ít nhất một sản phẩm.`);
      }
      if (rawItems.length > 50) {
        throw new AppError(`Đơn ${orderCode} chỉ được có tối đa 50 sản phẩm chính.`);
      }
      const platformFee = nonNegativeNumber(rawOrder?.platformFee || 0, "Phí sàn");
      const orderProductCodes = new Set();
      const orderLines = [];
      let shoeUnits = 0;

      for (const [itemIndex, rawItem] of rawItems.entries()) {
        const code = cleanText(
          rawItem?.code,
          `Mã sản phẩm ở dòng ${itemIndex + 1} của đơn ${orderIndex + 1}`
        ).toUpperCase();
        if (orderProductCodes.has(code)) {
          throw new AppError(`Sản phẩm ${code} bị lặp trong đơn ${orderCode}.`);
        }
        orderProductCodes.add(code);

        let product = productCache.get(code);
        if (!product) {
          product = getProductByCode(code);
          if (!product) throw new AppError(`Không tìm thấy sản phẩm ${code}.`, 404);
          productCache.set(code, product);
        }
        if (!saleCategoryNames.has(product.category_name)) {
          throw new AppError("Khi xuất hàng chỉ được chọn danh mục Giày hoặc Xịt khử mùi.");
        }
        if (
          rawItem?.categoryId !== undefined &&
          Number(rawItem.categoryId) !== Number(product.category_id)
        ) {
          throw new AppError(`Sản phẩm ${code} không thuộc danh mục đã chọn.`);
        }
        const quantity = positiveInteger(rawItem?.quantity, `Số lượng của ${code}`);
        const salePrice = nonNegativeNumber(rawItem?.salePrice, `Giá bán của ${code}`);
        const discount = cleanDiscount(
          rawItem?.discountType,
          rawItem?.discountValue,
          salePrice
        );
        const line = {
          orderCode,
          product,
          quantity,
          salePrice,
          unitCost: landedCost(product),
          discount,
          lineRole: "main"
        };
        orderLines.push(line);
        preparedLines.push(line);
        addStockRequirement(product, quantity, salePrice);
        if (product.category_name === "Giày") shoeUnits += quantity;
      }

      if (shoeUnits > 0) {
        for (const rule of shoeBundleRules) {
          let product = bundleProductCache.get(rule.categoryName);
          if (!product) {
            product = getBundleProduct(rule.categoryName);
            if (!product) {
              throw new AppError(
                `Chưa có tồn kho cho sản phẩm đi kèm ${rule.categoryName}. ` +
                "Hãy nhập hàng trước khi xuất đơn Giày."
              );
            }
            bundleProductCache.set(rule.categoryName, product);
          }
          const quantity = rule.perOrder ? rule.quantity : rule.quantity * shoeUnits;
          const line = {
            orderCode,
            product,
            quantity,
            salePrice: rule.price,
            unitCost: rule.price,
            discount: { type: null, value: 0 },
            lineRole: "addon"
          };
          orderLines.push(line);
          preparedLines.push(line);
          addStockRequirement(product, quantity, null);
        }
      }

      preparedOrders.push({ orderCode, platformFee, lines: orderLines });
    }

    if (preparedLines.length > 300) {
      throw new AppError("Mỗi lần xuất chỉ được có tối đa 300 dòng sản phẩm kể cả hàng đi kèm.");
    }
    for (const requirement of stockRequirements.values()) {
      if (Number(requirement.product.stock) < requirement.quantity) {
        throw new AppError(
          `Sản phẩm ${requirement.product.code} không đủ tồn kho. ` +
          `Cần ${requirement.quantity}, hiện còn ${requirement.product.stock}.`
        );
      }
    }

    const insertOrder = db.prepare(`
      INSERT INTO sales_orders
        (order_code, sales_channel, status, platform_fee, operator_name, created_at, updated_at)
      VALUES (?, ?, 'pending_pickup', ?, ?, ?, ?)
    `);
    for (const order of preparedOrders) {
      insertOrder.run(
        order.orderCode,
        channel,
        order.platformFee,
        user.name,
        timestamp,
        timestamp
      );
    }

    for (const requirement of stockRequirements.values()) {
      if (requirement.salePrice === null) {
        db.prepare("UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?")
          .run(requirement.quantity, timestamp, requirement.product.id);
      } else {
        db.prepare(`
          UPDATE products SET stock = stock - ?, sale_price = ?, updated_at = ? WHERE id = ?
        `).run(
          requirement.quantity,
          requirement.salePrice,
          timestamp,
          requirement.product.id
        );
      }
    }

    const insertTransaction = db.prepare(`
      INSERT INTO transactions
        (product_id, kind, quantity, unit_price, unit_cost, sales_channel, order_code,
         operator_name, discount_type, discount_value, line_role, created_at)
      VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const line of preparedLines) {
      insertTransaction.run(
        line.product.id,
        line.quantity,
        line.salePrice,
        line.unitCost,
        channel,
        line.orderCode,
        user.name,
        line.discount.type,
        line.discount.value,
        line.lineRole,
        timestamp
      );
    }
    db.exec("COMMIT");
    return {
      ordersCreated: preparedOrders.length,
      mainItemsCreated: preparedLines.filter((line) => line.lineRole === "main").length,
      itemsCreated: preparedLines.length,
      products: [...stockRequirements.values()].map((item) => (
        productView(getProductByCode(item.product.code))
      ))
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function orderView(order, itemRows) {
  const items = itemRows.map(transactionView);
  const mainItems = items.filter((item) => item.lineRole === "main");
  const addons = items.filter((item) => item.lineRole === "addon");
  const originalRevenue = mainItems.reduce((sum, item) => sum + item.total, 0);
  const originalCogs = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  const reversed = terminalOrderStatuses.has(order.status);
  const revenue = reversed ? 0 : originalRevenue;
  const platformFee = reversed ? 0 : Number(order.platform_fee || 0);
  const cogs = reversed ? 0 : originalCogs;
  return {
    id: Number(order.id),
    orderCode: order.order_code,
    channel: order.sales_channel,
    status: order.status,
    operatorName: order.operator_name || null,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    stockRestoredAt: order.stock_restored_at || null,
    revenue,
    platformFee,
    platformFeePercent: revenue > 0 ? platformFee * 100 / revenue : 0,
    cogs,
    profit: revenue - platformFee - cogs,
    items: mainItems,
    addons
  };
}

function listOrders({ start, end, status, id, limit = 500 } = {}) {
  const where = [];
  const parameters = [];
  if (start) {
    where.push("created_at >= ?");
    parameters.push(start);
  }
  if (end) {
    where.push("created_at < ?");
    parameters.push(end);
  }
  if (status) {
    where.push("status = ?");
    parameters.push(cleanOrderStatus(status));
  }
  if (id) {
    where.push("id = ?");
    parameters.push(id);
  }
  const orders = db.prepare(`
    SELECT * FROM sales_orders
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...parameters, limit);
  if (orders.length === 0) return [];
  const placeholders = orders.map(() => "?").join(", ");
  const itemRows = db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.sales_channel, t.order_code,
           t.operator_name, t.discount_type, t.discount_value, t.line_role,
           so.status AS order_status, so.platform_fee,
           t.created_at, p.code, p.name, p.category_id, p.size, p.color, p.unit,
           c.name AS category_name
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    WHERE t.kind = 'OUT' AND t.order_code IN (${placeholders})
    ORDER BY t.id ASC
  `).all(...orders.map((order) => order.order_code));
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const rows = itemsByOrder.get(item.order_code) || [];
    rows.push(item);
    itemsByOrder.set(item.order_code, rows);
  }
  return orders.map((order) => orderView(order, itemsByOrder.get(order.order_code) || []));
}

function updateOrderStatus(id, body) {
  const nextStatus = cleanOrderStatus(body.status);
  const order = db.prepare("SELECT * FROM sales_orders WHERE id = ?").get(id);
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  if (order.status === nextStatus) return listOrders({ id, limit: 1 })[0];
  if (terminalOrderStatuses.has(order.status)) {
    throw new AppError("Đơn đã trả hoặc hủy là trạng thái cuối và không thể mở lại.");
  }

  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (terminalOrderStatuses.has(nextStatus)) {
      const quantities = db.prepare(`
        SELECT product_id, SUM(quantity) AS quantity
        FROM transactions
        WHERE kind = 'OUT' AND order_code = ?
        GROUP BY product_id
      `).all(order.order_code);
      const restoreProduct = db.prepare(`
        UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?
      `);
      for (const item of quantities) {
        restoreProduct.run(Number(item.quantity), timestamp, item.product_id);
      }
      db.prepare(`
        UPDATE sales_orders
        SET status = ?, stock_restored_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, timestamp, timestamp, id);
    } else {
      db.prepare("UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, timestamp, id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listOrders({ id, limit: 1 })[0];
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
    SELECT COALESCE(t.sales_channel, 'unknown') AS channel,
           COUNT(DISTINCT COALESCE(t.order_code, 'LEGACY-' || t.id)) AS orders,
           COALESCE(SUM(CASE WHEN t.line_role = 'main' THEN t.quantity ELSE 0 END), 0)
             AS units,
           COALESCE(SUM(CASE WHEN t.line_role = 'main' THEN t.quantity * CASE
             WHEN t.discount_type = 'percent' THEN t.unit_price * (1 - t.discount_value / 100.0)
             WHEN t.discount_type = 'amount' THEN MAX(0, t.unit_price - t.discount_value)
             ELSE t.unit_price
           END ELSE 0 END), 0) AS revenue,
           COALESCE(SUM(t.quantity * t.unit_cost), 0) AS cogs
    FROM transactions t
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    WHERE t.kind = 'OUT' AND t.created_at >= ? AND t.created_at < ?
      AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
    GROUP BY COALESCE(t.sales_channel, 'unknown')
  `).all(range.start, range.end);
  const feeRows = db.prepare(`
    SELECT COALESCE(sales_channel, 'unknown') AS channel,
           COALESCE(SUM(platform_fee), 0) AS platform_fee
    FROM sales_orders
    WHERE created_at >= ? AND created_at < ?
      AND status NOT IN ('returned', 'cancelled')
    GROUP BY COALESCE(sales_channel, 'unknown')
  `).all(range.start, range.end);
  const rowMap = new Map(rows.map((row) => [row.channel, row]));
  const feeMap = new Map(feeRows.map((row) => [row.channel, Number(row.platform_fee)]));
  const availableChannels = [...salesChannels];
  if (rowMap.has("unknown")) availableChannels.push("unknown");
  const channels = availableChannels.map((channel) => {
    const row = rowMap.get(channel);
    const revenue = Number(row?.revenue || 0);
    const cogs = Number(row?.cogs || 0);
    const platformFees = feeMap.get(channel) || 0;
    return {
      channel,
      orders: Number(row?.orders || 0),
      units: Number(row?.units || 0),
      revenue,
      platformFees,
      cogs,
      profit: revenue - platformFees - cogs
    };
  });
  const totals = channels.reduce((result, item) => ({
    orders: result.orders + item.orders,
    units: result.units + item.units,
    revenue: result.revenue + item.revenue,
    platformFees: result.platformFees + item.platformFees,
    cogs: result.cogs + item.cogs,
    profit: result.profit + item.profit
  }), { orders: 0, units: 0, revenue: 0, platformFees: 0, cogs: 0, profit: 0 });
  const products = db.prepare(`
    SELECT p.code, p.name,
           COUNT(DISTINCT COALESCE(t.order_code, 'LEGACY-' || t.id)) AS orders,
           COALESCE(SUM(t.quantity), 0) AS units,
           COALESCE(SUM(t.quantity * CASE
             WHEN t.discount_type = 'percent' THEN t.unit_price * (1 - t.discount_value / 100.0)
             WHEN t.discount_type = 'amount' THEN MAX(0, t.unit_price - t.discount_value)
             ELSE t.unit_price
           END), 0) AS revenue
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN sales_orders so ON so.order_code = t.order_code
    WHERE t.kind = 'OUT' AND t.line_role = 'main'
      AND t.created_at >= ? AND t.created_at < ?
      AND (so.id IS NULL OR so.status NOT IN ('returned', 'cancelled'))
    GROUP BY t.product_id, p.code, p.name
    ORDER BY units DESC, revenue DESC, p.name ASC
    LIMIT 10
  `).all(range.start, range.end).map((row) => ({
    code: row.code,
    name: row.name,
    orders: Number(row.orders),
    units: Number(row.units),
    revenue: Number(row.revenue)
  }));
  const orders = listOrders({ start: range.start, end: range.end, limit: 500 });
  return { range, channels, totals, products, orders };
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

function changeAdminPassword(body, user, request) {
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = cleanPassword(body.newPassword);
  const confirmation = String(body.confirmPassword ?? "");
  if (newPassword !== confirmation) {
    throw new AppError("Mật khẩu mới và phần xác nhận không trùng khớp.");
  }
  const admin = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'admin'").get(user.id);
  if (!admin || !verifyPassword(currentPassword, admin.password_salt, admin.password_hash)) {
    throw new AppError("Mật khẩu hiện tại không đúng.");
  }
  if (verifyPassword(newPassword, admin.password_salt, admin.password_hash)) {
    throw new AppError("Mật khẩu mới phải khác mật khẩu hiện tại.");
  }
  const passwordData = hashPassword(newPassword);
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, updated_at = ?
      WHERE id = ? AND role = 'admin'
    `).run(passwordData.hash, passwordData.salt, timestamp, user.id);
    const currentToken = parseCookies(request).inventory_session;
    if (currentToken) {
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(
        user.id,
        sessionHash(currentToken)
      );
    } else {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, updatedAt: timestamp };
}

function routeId(pathname, prefix) {
  const match = new RegExp(`^${prefix}/(\\d+)$`).exec(pathname);
  return match ? Number(match[1]) : null;
}

function routeActionId(pathname, prefix, action) {
  const match = new RegExp(`^${prefix}/(\\d+)/${action}$`).exec(pathname);
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
    if (url.pathname === "/api/categories") {
      if (request.method === "GET") return json(response, 200, listCategories());
      if (request.method === "POST") {
        return json(response, 201, addCategory(await readJson(request)));
      }
    }
    if (request.method === "GET" && url.pathname === "/api/products") {
      return json(response, 200, listProducts(url.searchParams.get("q") || ""));
    }
    if (request.method === "GET" && url.pathname === "/api/transactions") {
      return json(response, 200, listTransactions());
    }
    if (request.method === "GET" && url.pathname === "/api/sales/config") {
      return json(response, 200, salesConfigView());
    }
    if (request.method === "GET" && url.pathname === "/api/orders/next-code") {
      return json(response, 200, nextOrderCodeInfo());
    }
    if (request.method === "GET" && url.pathname === "/api/orders") {
      return json(response, 200, listOrders({ status: url.searchParams.get("status") || undefined }));
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
    const stockProductId = routeActionId(url.pathname, "/api/products", "stock");
    if (request.method === "PUT" && stockProductId !== null) {
      return json(response, 200, adjustStock(stockProductId, await readJson(request), user));
    }
    const statusOrderId = routeActionId(url.pathname, "/api/orders", "status");
    if (request.method === "PUT" && statusOrderId !== null) {
      return json(response, 200, updateOrderStatus(statusOrderId, await readJson(request)));
    }
    if (request.method === "PUT" && url.pathname === "/api/admin/password") {
      requireAdmin(user);
      return json(
        response,
        200,
        changeAdminPassword(await readJson(request), user, request)
      );
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
