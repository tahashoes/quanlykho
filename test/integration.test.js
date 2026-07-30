import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Máy chủ kiểm thử đã dừng với mã ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Máy chủ kiểm thử không khởi động đúng thời hạn.");
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status}: ${payload.error || "Yêu cầu thất bại"}`);
  }
  return { payload, response };
}

test("luồng danh mục, nhập/xuất hàng và đổi mật khẩu admin", async () => {
  const testRoot = join(tmpdir(), `quanlykho-test-${process.pid}-${Date.now()}`);
  mkdirSync(testRoot, { recursive: true });
  const databasePath = join(testRoot, "test.db");
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
      cost_price REAL NOT NULL CHECK(cost_price >= 0),
      sale_price REAL NOT NULL CHECK(sale_price >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO products
      (code, name, stock, cost_price, sale_price, created_at, updated_at)
    VALUES
      ('LEGACY-01', 'Giày dữ liệu cũ', 3, 100000, 180000,
       '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
  `);
  legacyDatabase.close();
  const port = 32147;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: databasePath,
      ADMIN_PHONE: "0900000000",
      ADMIN_PASSWORD: "Admin@123",
      COOKIE_SECURE: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitForServer(baseUrl, child);
    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone: "0900000000", password: "Admin@123" })
    });
    assert.equal(login.payload.role, "admin");
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const authHeaders = { Cookie: cookie };

    const categories = await request(baseUrl, "/api/categories", { headers: authHeaders });
    assert.equal(categories.payload.length, 6);
    const shoes = categories.payload.find((category) => category.name === "Giày");
    assert.equal(shoes.requiresSize, true);

    const newCategory = await request(baseUrl, "/api/categories", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Túi đóng gói", requiresSize: false })
    });
    assert.equal(newCategory.payload.name, "Túi đóng gói");

    const product = await request(baseUrl, "/api/products", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        categoryId: shoes.id,
        code: "GIAY-TEST-01",
        name: "Giày kiểm thử",
        size: "38",
        color: "Đen",
        quantity: 10,
        unit: "đôi",
        costPrice: 108000,
        salePrice: ""
      })
    });
    assert.equal(product.payload.categoryName, "Giày");
    assert.equal(product.payload.size, "38");
    assert.equal(product.payload.color, "Đen");
    assert.equal(product.payload.unit, "đôi");
    assert.equal(product.payload.salePrice, 0);

    const sale = await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "website",
        orders: [{
          orderCode: "TEST-ORDER-01",
          items: [{
            categoryId: shoes.id,
            code: "GIAY-TEST-01",
            quantity: 2,
            salePrice: 200000,
            discountType: "percent",
            discountValue: 10
          }]
        }]
      })
    });
    assert.equal(sale.payload.itemsCreated, 1);

    const products = await request(baseUrl, "/api/products", { headers: authHeaders });
    assert.equal(products.payload.find((item) => item.code === "GIAY-TEST-01").stock, 8);
    const migratedProduct = products.payload.find((item) => item.code === "LEGACY-01");
    assert.equal(migratedProduct.categoryName, "Giày");
    assert.equal(migratedProduct.unit, "cái");

    const passwordChange = await request(baseUrl, "/api/admin/password", {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        currentPassword: "Admin@123",
        newPassword: "Admin@456",
        confirmPassword: "Admin@456"
      })
    });
    assert.equal(passwordChange.payload.ok, true);

    const currentSession = await request(baseUrl, "/api/auth/me", { headers: authHeaders });
    assert.equal(currentSession.payload.role, "admin");
    const newLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone: "0900000000", password: "Admin@456" })
    });
    assert.equal(newLogin.payload.role, "admin");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolveClose) => {
      if (child.exitCode !== null) return resolveClose();
      child.once("close", resolveClose);
      setTimeout(resolveClose, 2000);
    });
    rmSync(testRoot, { recursive: true, force: true });
    if (stderr) process.stderr.write(stderr);
  }
});
