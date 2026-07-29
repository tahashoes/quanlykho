import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DB_PATH || resolve("data", "quanlykho.db");
const apiToken = process.env.INVENTORY_API_TOKEN || "";
const publicDir = resolve("public");

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
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_product_id ON transactions(product_id);
`);

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

function cleanText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} không được để trống.`);
  return text;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} phải là số nguyên lớn hơn 0.`);
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} phải là số không âm.`);
  }
  return number;
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
    updatedAt: product.updated_at
  };
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Dữ liệu gửi lên quá lớn.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("Dữ liệu gửi lên không hợp lệ.");
  }
}

function isAuthorized(request) {
  return !apiToken || request.headers["x-api-key"] === apiToken;
}

function sendError(response, error) {
  const isClientError = /không|phải|đã tồn tại|không đủ/i.test(error.message);
  json(response, isClientError ? 400 : 500, { error: error.message || "Có lỗi xảy ra." });
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
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.created_at, p.code, p.name
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
    recent: recent.map((row) => ({
      id: Number(row.id), kind: row.kind, quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
      unitCost: Number(row.unit_cost), createdAt: row.created_at, code: row.code, name: row.name
    }))
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

function listTransactions() {
  return db.prepare(`
    SELECT t.id, t.kind, t.quantity, t.unit_price, t.unit_cost, t.created_at, p.code, p.name
    FROM transactions t JOIN products p ON p.id = t.product_id
    ORDER BY t.id DESC LIMIT 100
  `).all().map((row) => ({
    id: Number(row.id), kind: row.kind, quantity: Number(row.quantity), unitPrice: Number(row.unit_price),
    unitCost: Number(row.unit_cost), createdAt: row.created_at, code: row.code, name: row.name
  }));
}

function addProduct(body) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const name = cleanText(body.name, "Tên sản phẩm");
  const quantity = positiveInteger(body.quantity, "Số lượng");
  const costPrice = nonNegativeNumber(body.costPrice, "Đơn giá nhập");
  const salePrice = nonNegativeNumber(body.salePrice, "Giá bán");
  const timestamp = now();

  db.exec("BEGIN IMMEDIATE");
  try {
    if (getProductByCode(code)) throw new Error("Mã sản phẩm đã tồn tại. Hãy dùng mục Nhập thêm hàng.");
    const result = db.prepare(`
      INSERT INTO products (code, name, stock, cost_price, sale_price, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code, name, quantity, costPrice, salePrice, timestamp, timestamp);
    db.prepare(`
      INSERT INTO transactions (product_id, kind, quantity, unit_price, unit_cost, created_at)
      VALUES (?, 'IN', ?, ?, ?, ?)
    `).run(Number(result.lastInsertRowid), quantity, costPrice, costPrice, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

function receiveStock(body) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const quantity = positiveInteger(body.quantity, "Số lượng nhập");
  const costPrice = nonNegativeNumber(body.costPrice, "Đơn giá nhập");
  const salePrice = body.salePrice === undefined || body.salePrice === ""
    ? undefined
    : nonNegativeNumber(body.salePrice, "Giá bán");
  const product = getProductByCode(code);
  if (!product) throw new Error("Không tìm thấy sản phẩm theo mã này.");
  const timestamp = now();
  const newStock = Number(product.stock) + quantity;
  const weightedCost = ((Number(product.stock) * Number(product.cost_price)) + (quantity * costPrice)) / newStock;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE products SET stock = ?, cost_price = ?, sale_price = ?, updated_at = ? WHERE id = ?`)
      .run(newStock, weightedCost, salePrice ?? Number(product.sale_price), timestamp, product.id);
    db.prepare(`
      INSERT INTO transactions (product_id, kind, quantity, unit_price, unit_cost, created_at)
      VALUES (?, 'IN', ?, ?, ?, ?)
    `).run(product.id, quantity, costPrice, costPrice, timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

function sellStock(body) {
  const code = cleanText(body.code, "Mã sản phẩm").toUpperCase();
  const quantity = positiveInteger(body.quantity, "Số lượng xuất");
  const salePrice = nonNegativeNumber(body.salePrice, "Giá bán");
  const product = getProductByCode(code);
  if (!product) throw new Error("Không tìm thấy sản phẩm theo mã này.");
  if (Number(product.stock) < quantity) {
    throw new Error(`Số lượng tồn không đủ. Hiện còn ${product.stock}.`);
  }
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE products SET stock = stock - ?, sale_price = ?, updated_at = ? WHERE id = ?")
      .run(quantity, salePrice, timestamp, product.id);
    db.prepare(`
      INSERT INTO transactions (product_id, kind, quantity, unit_price, unit_cost, created_at)
      VALUES (?, 'OUT', ?, ?, ?, ?)
    `).run(product.id, quantity, salePrice, Number(product.cost_price), timestamp);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return productView(getProductByCode(code));
}

async function serveStatic(request, response, url) {
  const requested = url.pathname === "/" ? "index.html" : basename(url.pathname);
  const filePath = resolve(publicDir, requested);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Không tìm thấy trang.");
    return;
  }
  const file = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
  response.end(file);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(request)) return json(response, 401, { error: "Mã bảo vệ API không đúng." });
      if (request.method === "GET" && url.pathname === "/api/dashboard") return json(response, 200, dashboard());
      if (request.method === "GET" && url.pathname === "/api/products") return json(response, 200, listProducts(url.searchParams.get("q") || ""));
      if (request.method === "GET" && url.pathname === "/api/transactions") return json(response, 200, listTransactions());
      if (request.method === "POST" && url.pathname === "/api/products") return json(response, 201, addProduct(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/receipts") return json(response, 201, receiveStock(await readJson(request)));
      if (request.method === "POST" && url.pathname === "/api/sales") return json(response, 201, sellStock(await readJson(request)));
      return json(response, 404, { error: "Không tìm thấy API." });
    }
    await serveStatic(request, response, url);
  } catch (error) {
    sendError(response, error);
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
