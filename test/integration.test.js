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

test("đơn nhiều sản phẩm, hàng kèm, phí sàn, trạng thái và hoàn tồn kho", async () => {
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
  const port = 32_000 + (process.pid % 1_000);
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

    const categoriesResponse = await request(baseUrl, "/api/categories", { headers: authHeaders });
    assert.equal(categoriesResponse.payload.length, 6);
    const categories = Object.fromEntries(
      categoriesResponse.payload.map((category) => [category.name, category])
    );
    assert.equal(categories["Giày"].requiresSize, true);

    const createProduct = async (data) => (
      await request(baseUrl, "/api/products", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(data)
      })
    ).payload;

    const shoe = await createProduct({
      categoryId: categories["Giày"].id,
      code: "giay-test-01",
      name: "Giày kiểm thử",
      size: "38",
      color: "Xanh",
      quantity: 10,
      unit: "đôi",
      costPrice: "100,000",
      shippingCost: "8,000",
      salePrice: "200,000"
    });
    assert.equal(shoe.code, "GIAY-TEST-01");
    assert.equal(shoe.landedCost, 108000);
    assert.equal(shoe.inventoryValue, 1080000);

    await createProduct({
      categoryId: categories["Vớ"].id,
      code: "VO-MD",
      name: "Vớ mặc định",
      size: "Mặc định",
      quantity: 20,
      unit: "đôi",
      costPrice: 3000,
      shippingCost: 0,
      salePrice: 9000
    });
    const spray = await createProduct({
      categoryId: categories["Xịt khử mùi"].id,
      code: "XIT-MD",
      name: "Xịt khử mùi mặc định",
      color: "Xanh",
      quantity: 20,
      unit: "chai",
      costPrice: 6000,
      shippingCost: 0,
      salePrice: 50000
    });
    await createProduct({
      categoryId: categories["Thùng Carton"].id,
      code: "CARTON-MD",
      name: "Thùng Carton mặc định",
      quantity: 20,
      unit: "thùng",
      costPrice: 4000,
      shippingCost: 0,
      salePrice: 8000
    });
    await createProduct({
      categoryId: categories["Băng keo"].id,
      code: "KEO-MD",
      name: "Băng keo mặc định",
      quantity: 20,
      unit: "cuộn",
      costPrice: 500,
      shippingCost: 0,
      salePrice: 1000
    });
    const paper = await createProduct({
      categoryId: categories["Giấy in"].id,
      code: "GIAY-IN-MD",
      name: "Giấy in bill",
      quantity: 1,
      unit: "sấp",
      costPrice: "50,000",
      shippingCost: 0,
      salePrice: 200
    });
    assert.equal(paper.stock, 500);
    assert.equal(paper.unit, "tờ");
    assert.equal(paper.costPrice, 100);

    const config = await request(baseUrl, "/api/sales/config", { headers: authHeaders });
    assert.deepEqual(
      config.payload.allowedCategories.map((category) => category.name),
      ["Giày", "Xịt khử mùi"]
    );
    assert.equal(config.payload.addons.length, 5);
    assert.equal(config.payload.addons.find((item) => item.categoryName === "Giấy in").perOrder, true);

    const nextCode = await request(baseUrl, "/api/orders/next-code", { headers: authHeaders });
    assert.match(nextCode.payload.code, /^TAHA-\d{8}-001$/);

    const sale = await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "shopee",
        orders: [{
          orderCode: nextCode.payload.code,
          platformFee: "45,000",
          items: [
            {
              categoryId: categories["Giày"].id,
              code: "GIAY-TEST-01",
              quantity: 2,
              salePrice: "200,000"
            },
            {
              categoryId: categories["Xịt khử mùi"].id,
              code: spray.code,
              quantity: 1,
              salePrice: "50,000"
            }
          ]
        }]
      })
    });
    assert.equal(sale.payload.ordersCreated, 1);
    assert.equal(sale.payload.mainItemsCreated, 2);
    assert.equal(sale.payload.itemsCreated, 7);

    let products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    const stockOf = (code) => products.find((product) => product.code === code).stock;
    assert.equal(stockOf("GIAY-TEST-01"), 8);
    assert.equal(stockOf("VO-MD"), 18);
    assert.equal(stockOf("XIT-MD"), 17);
    assert.equal(stockOf("CARTON-MD"), 18);
    assert.equal(stockOf("KEO-MD"), 18);
    assert.equal(stockOf("GIAY-IN-MD"), 499);

    let orders = (await request(baseUrl, "/api/orders", { headers: authHeaders })).payload;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "pending_pickup");
    assert.equal(orders[0].items.length, 2);
    assert.equal(orders[0].addons.length, 5);
    assert.equal(orders[0].revenue, 450000);
    assert.equal(orders[0].platformFee, 45000);
    assert.equal(orders[0].platformFeePercent, 10);
    assert.equal(orders[0].cogs, 278200);
    assert.equal(orders[0].profit, 126800);

    let dashboard = (await request(baseUrl, "/api/dashboard", { headers: authHeaders })).payload;
    assert.equal(dashboard.revenue, 450000);
    assert.equal(dashboard.platformFees, 45000);
    assert.equal(dashboard.cogs, 278200);
    assert.equal(dashboard.profit, 126800);

    const orderId = orders[0].id;
    const shippingStatus = await request(baseUrl, `/api/orders/${orderId}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "shipping" })
    });
    assert.equal(shippingStatus.payload.status, "shipping");

    const returned = await request(baseUrl, `/api/orders/${orderId}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "returned" })
    });
    assert.equal(returned.payload.status, "returned");
    assert.equal(returned.payload.revenue, 0);
    assert.equal(returned.payload.platformFee, 0);
    assert.equal(returned.payload.cogs, 0);
    assert.equal(returned.payload.profit, 0);

    products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    assert.equal(stockOf("GIAY-TEST-01"), 10);
    assert.equal(stockOf("VO-MD"), 20);
    assert.equal(stockOf("XIT-MD"), 20);
    assert.equal(stockOf("GIAY-IN-MD"), 500);

    await request(baseUrl, `/api/orders/${orderId}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "returned" })
    });
    products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    assert.equal(stockOf("GIAY-TEST-01"), 10, "không được hoàn kho hai lần");
    await assert.rejects(
      request(baseUrl, `/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: "completed" })
      }),
      /trạng thái cuối/
    );

    const secondCode = await request(baseUrl, "/api/orders/next-code", { headers: authHeaders });
    assert.match(secondCode.payload.code, /^TAHA-\d{8}-002$/);
    await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "tiktok",
        orders: [{
          orderCode: secondCode.payload.code,
          platformFee: 5000,
          items: [{
            categoryId: categories["Xịt khử mùi"].id,
            code: "XIT-MD",
            quantity: 1,
            salePrice: 50000
          }]
        }]
      })
    });
    orders = (await request(baseUrl, "/api/orders", { headers: authHeaders })).payload;
    const secondOrder = orders.find((order) => order.orderCode === secondCode.payload.code);
    await request(baseUrl, `/api/orders/${secondOrder.id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "cancelled" })
    });

    const thirdCode = await request(baseUrl, "/api/orders/next-code", { headers: authHeaders });
    assert.match(thirdCode.payload.code, /^TAHA-\d{8}-003$/);
    await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "website",
        orders: [{
          orderCode: thirdCode.payload.code,
          platformFee: 20000,
          items: [{
            categoryId: categories["Giày"].id,
            code: "GIAY-TEST-01",
            quantity: 1,
            salePrice: 200000
          }]
        }]
      })
    });
    orders = (await request(baseUrl, "/api/orders", { headers: authHeaders })).payload;
    const thirdOrder = orders.find((order) => order.orderCode === thirdCode.payload.code);
    const completed = await request(baseUrl, `/api/orders/${thirdOrder.id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "completed" })
    });
    assert.equal(completed.payload.revenue, 200000);
    assert.equal(completed.payload.platformFee, 20000);
    assert.equal(completed.payload.cogs, 136200);
    assert.equal(completed.payload.profit, 43800);

    const today = new Date();
    const anchor = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
    const report = await request(
      baseUrl,
      `/api/reports?period=day&anchor=${anchor}`,
      { headers: authHeaders }
    );
    assert.equal(report.payload.totals.orders, 1);
    assert.equal(report.payload.totals.revenue, 200000);
    assert.equal(report.payload.totals.platformFees, 20000);
    assert.equal(report.payload.totals.cogs, 136200);
    assert.equal(report.payload.totals.profit, 43800);
    assert.equal(report.payload.orders.length, 3);

    const adjusted = await request(baseUrl, `/api/products/${shoe.id}/stock`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ stock: 25 })
    });
    assert.equal(adjusted.payload.stock, 25);
    const received = await request(baseUrl, "/api/receipts", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        code: "giay-test-01",
        quantity: 5,
        inputUnit: "đôi",
        costPrice: "110,000",
        shippingCost: "10,000",
        salePrice: "210,000"
      })
    });
    assert.equal(received.payload.stock, 30);
    assert.equal(received.payload.salePrice, 210000);

    const migratedProducts = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    const migratedProduct = migratedProducts.find((item) => item.code === "LEGACY-01");
    assert.equal(migratedProduct.categoryName, "Giày");
    assert.equal(migratedProduct.shippingCost, 0);

    dashboard = (await request(baseUrl, "/api/dashboard", { headers: authHeaders })).payload;
    assert.equal(dashboard.revenue, 200000);
    assert.equal(dashboard.inventoryValue > 0, true);

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
