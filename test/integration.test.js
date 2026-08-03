import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { scryptSync } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ExcelJS from "exceljs";

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

test("luồng nhập/xuất theo danh mục, công thức lợi nhuận và reset dữ liệu", async () => {
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
      ('LEGACY-01', 'Dữ liệu cần reset', 3, 100000, 180000,
       '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
    CREATE TABLE sales_orders (
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
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'manager')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const legacyAdminSalt = "00112233445566778899aabbccddeeff";
  legacyDatabase.prepare(`
    INSERT INTO users
      (display_name, phone, password_hash, password_salt, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', ?, ?)
  `).run(
    "Quản trị viên",
    "0900000000",
    scryptSync("OldAdmin@123", legacyAdminSalt, 64).toString("hex"),
    legacyAdminSalt,
    "2025-01-01T00:00:00.000Z",
    "2025-01-01T00:00:00.000Z"
  );
  legacyDatabase.close();

  const port = 32_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: databasePath,
      ADMIN_LOGIN: "admin@tahashoes",
      ADMIN_PASSWORD: "Admin@123",
      ADMIN_CREDENTIALS_VERSION: "integration-admin-v1",
      APP_VERSION: "integration-test-sha",
      COOKIE_SECURE: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitForServer(baseUrl, child);

    const health = await request(baseUrl, "/api/health");
    assert.deepEqual(health.payload, { ok: true, version: "integration-test-sha" });

    const page = await (await fetch(baseUrl)).text();
    assert.match(page, /THÊM DANH MỤC MỚI/);
    assert.doesNotMatch(page, /Bổ sung tồn|Nhập thêm hàng/);
    assert.match(page, /data-view="orders">Đơn hàng/);
    assert.match(page, /id="sale-history-table"/);
    assert.match(page, /id="order-list"/);
    assert.match(page, /id="order-overview"/);
    assert.match(page, /data-period="quarter"/);
    assert.match(page, /data-period="year"/);
    assert.match(page, /data-report-export="xlsx"/);
    assert.match(page, /data-report-export="pdf"/);
    const appScript = await (await fetch(`${baseUrl}/app.js`)).text();
    assert.match(appScript, /delivered: "Đã giao"/);
    assert.match(appScript, /cancelled: "Đã Hủy"/);
    assert.match(appScript, /data-sale-stock-note/);
    assert.match(appScript, /Tồn không đủ/);
    assert.match(appScript, /data-draft-cogs-breakdown/);
    assert.match(appScript, /directSalesChannels/);
    assert.match(appScript, /customerAddress/);
    assert.match(appScript, /\/inventory/);
    assert.match(appScript, /"Vớ": "VO-001"/);
    assert.match(appScript, /"Xịt khử mùi": "XKM-001"/);
    assert.match(appScript, /history-order-products/);
    const styles = await (await fetch(`${baseUrl}/styles.css`)).text();
    assert.match(styles, /input\.has-value/);

    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: "admin@tahashoes", password: "Admin@123" })
    });
    assert.equal(login.payload.role, "admin");
    assert.equal(login.payload.login, "admin@tahashoes");
    await assert.rejects(
      request(baseUrl, "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ phone: "0900000000", password: "OldAdmin@123" })
      }),
      /Tên đăng nhập hoặc mật khẩu không đúng/
    );
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const authHeaders = { Cookie: cookie };

    const categoriesResponse = await request(baseUrl, "/api/categories", {
      headers: authHeaders
    });
    assert.equal(categoriesResponse.payload.length, 6);
    const categories = Object.fromEntries(
      categoriesResponse.payload.map((category) => [category.name, category])
    );
    assert.equal(categories["Giày"].defaultUnit, "đôi");
    assert.equal(categories["Giày"].requiresSize, true);
    assert.equal(categories["Giày"].fields.image, true);
    assert.equal(categories["Vớ"].defaultUnit, "đôi");
    assert.equal(categories["Vớ"].requiresSize, false);
    assert.equal(categories["Xịt khử mùi"].defaultUnit, "chai");
    assert.equal(categories["Xịt khử mùi"].fields.shippingCost, false);
    assert.equal(categories["Thùng Carton"].defaultUnit, "thùng");
    assert.equal(categories["Băng keo"].defaultUnit, "cuộn");
    assert.equal(categories["Giấy in"].defaultUnit, "sấp");
    assert.equal(categories["Giấy in"].fields.color, false);

    const resetProducts = await request(baseUrl, "/api/products", { headers: authHeaders });
    assert.deepEqual(resetProducts.payload, [], "dữ liệu hàng hóa cũ phải được reset");

    const customCategory = await request(baseUrl, "/api/categories", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "Túi đóng gói" })
    });
    assert.equal(customCategory.payload.defaultUnit, "cái");
    assert.equal(customCategory.payload.isDefault, false);

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
      size: "38",
      color: "Xanh",
      quantity: 10,
      unit: "đôi",
      costPrice: "100,000",
      shippingCost: "8,000",
      salePrice: "200,000"
    });
    assert.equal(shoe.code, "GIAY-TEST-01");
    assert.equal(shoe.name, "Giày GIAY-TEST-01");
    assert.equal(shoe.landedCost, 108000);

    const restockedShoe = await createProduct({
      categoryId: categories["Giày"].id,
      code: "GIAY-TEST-01",
      size: "38",
      color: "Xanh",
      quantity: 5,
      unit: "đôi",
      costPrice: "110,000",
      shippingCost: "10,000",
      salePrice: "210,000"
    });
    assert.equal(restockedShoe.stock, 15);
    assert.equal(restockedShoe.landedCost, 112000);
    assert.equal(restockedShoe.salePrice, 210000);

    const editedShoe = (await request(baseUrl, `/api/products/${restockedShoe.id}/inventory`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        stock: 16,
        shippingCost: "12,000",
        landedCost: "125,000",
        salePrice: "220,000"
      })
    })).payload;
    assert.equal(editedShoe.stock, 16);
    assert.equal(editedShoe.costPrice, 113000);
    assert.equal(editedShoe.shippingCost, 12000);
    assert.equal(editedShoe.landedCost, 125000);
    assert.equal(editedShoe.salePrice, 220000);
    await assert.rejects(
      request(baseUrl, `/api/products/${restockedShoe.id}/inventory`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          stock: 16,
          shippingCost: 13000,
          landedCost: 12000,
          salePrice: 220000
        })
      }),
      /Giá vốn không được nhỏ hơn phí vận chuyển/
    );

    await assert.rejects(
      createProduct({
        categoryId: categories["Giày"].id,
        code: "SAI-DON-VI",
        size: "39",
        quantity: 1,
        unit: "cái",
        costPrice: 100000,
        shippingCost: 0
      }),
      /Đơn vị mặc định của Giày là đôi/
    );

    await createProduct({
      categoryId: categories["Vớ"].id,
      code: "VO-MD",
      color: "Trắng",
      quantity: 20,
      unit: "đôi",
      costPrice: 3000,
      shippingCost: 1000
    });
    const spray = await createProduct({
      categoryId: categories["Xịt khử mùi"].id,
      code: "XIT-MD",
      color: "Xanh",
      quantity: 20,
      unit: "chai",
      costPrice: 6000,
      shippingCost: 9999
    });
    assert.equal(spray.shippingCost, 0, "xịt khử mùi không có phí vận chuyển");
    await createProduct({
      categoryId: categories["Thùng Carton"].id,
      code: "CARTON-MD",
      quantity: 20,
      unit: "thùng",
      costPrice: 4000,
      shippingCost: 1000
    });
    await createProduct({
      categoryId: categories["Băng keo"].id,
      code: "KEO-MD",
      quantity: 20,
      unit: "cuộn",
      costPrice: 500,
      shippingCost: 100
    });
    const paper = await createProduct({
      categoryId: categories["Giấy in"].id,
      code: "GIAY-IN-MD",
      quantity: 1,
      unit: "sấp",
      costPrice: "50,000",
      shippingCost: "50,000"
    });
    assert.equal(paper.stock, 500);
    assert.equal(paper.unit, "tờ");
    assert.equal(paper.costPrice, 100);
    assert.equal(paper.shippingCost, 100);

    const config = await request(baseUrl, "/api/sales/config", { headers: authHeaders });
    assert.deepEqual(
      config.payload.allowedCategories.map((category) => category.name),
      ["Giày", "Xịt khử mùi"]
    );
    assert.equal(config.payload.addons.length, 5);
    assert.equal(
      config.payload.addons.find((item) => item.categoryName === "Giấy in").perOrder,
      true
    );

    const nextCode = await request(baseUrl, "/api/orders/next-code", {
      headers: authHeaders
    });
    assert.match(nextCode.payload.code, /^TAHA-\d{8}-001$/);

    await assert.rejects(
      request(baseUrl, "/api/sales", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          channel: "shopee",
          orders: [{
            orderCode: "",
            platformFee: 0,
            items: [{
              categoryId: categories["Xịt khử mùi"].id,
              code: "XIT-MD",
              quantity: 1,
              salePrice: 50000
            }]
          }]
        })
      }),
      /Mã đơn hàng không được để trống/
    );

    await assert.rejects(
      request(baseUrl, "/api/sales", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          channel: "shopee",
          orders: [{
            orderCode: "INVALID-MAIN-01",
            platformFee: 0,
            items: [{
              categoryId: categories["Vớ"].id,
              code: "VO-MD",
              quantity: 1,
              salePrice: 9000
            }]
          }]
        })
      }),
      /chỉ cho phép chọn danh mục Giày hoặc Xịt khử mùi/
    );

    const sale = await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "shopee",
        orders: [{
          orderCode: nextCode.payload.code,
          platformFee: "42,000",
          items: [{
            categoryId: categories["Giày"].id,
            code: "GIAY-TEST-01",
            quantity: 2,
            salePrice: "210,000"
          }]
        }]
      })
    });
    assert.equal(sale.payload.ordersCreated, 1);
    assert.equal(sale.payload.mainItemsCreated, 1);
    assert.equal(sale.payload.itemsCreated, 6);

    let products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    const stockOf = (code) => products.find((product) => product.code === code).stock;
    assert.equal(stockOf("GIAY-TEST-01"), 14);
    assert.equal(stockOf("VO-MD"), 18);
    assert.equal(stockOf("XIT-MD"), 18);
    assert.equal(stockOf("CARTON-MD"), 18);
    assert.equal(stockOf("KEO-MD"), 18);
    assert.equal(stockOf("GIAY-IN-MD"), 499, "mỗi đơn chỉ xuất đúng một tờ giấy");

    const orders = (await request(baseUrl, "/api/orders", { headers: authHeaders })).payload;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].revenue, 420000);
    assert.equal(orders[0].platformFee, 42000);
    assert.equal(orders[0].platformFeePercent, 10);
    assert.equal(orders[0].shippingFee, 0);
    assert.equal(orders[0].sellingFee, 42000);
    assert.equal(orders[0].cogs, 306200);
    assert.equal(orders[0].profit, 71800);

    const dashboard = (await request(baseUrl, "/api/dashboard", {
      headers: authHeaders
    })).payload;
    assert.equal(dashboard.revenue, 420000);
    assert.equal(dashboard.platformFees, 42000);
    assert.equal(dashboard.shippingFees, 0);
    assert.equal(dashboard.sellingFees, 42000);
    assert.equal(dashboard.cogs, 306200);
    assert.equal(dashboard.profit, 71800);

    const removedReceiptEndpoint = await fetch(`${baseUrl}/api/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ code: "GIAY-TEST-01", quantity: 1 })
    });
    assert.equal(removedReceiptEndpoint.status, 404);

    const shipping = await request(baseUrl, `/api/orders/${orders[0].id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "shipping" })
    });
    assert.equal(shipping.payload.status, "shipping");
    const delivered = await request(baseUrl, `/api/orders/${orders[0].id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "delivered" })
    });
    assert.equal(delivered.payload.status, "delivered");
    const completed = await request(baseUrl, `/api/orders/${orders[0].id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "completed" })
    });
    assert.equal(completed.payload.status, "completed");
    assert.equal(completed.payload.revenue, 420000);
    assert.equal(completed.payload.cogs, 306200);
    await assert.rejects(
      request(baseUrl, `/api/orders/${orders[0].id}/status`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ status: "returned" })
      }),
      /Đơn đã ở trạng thái kết thúc/
    );

    const secondCode = await request(baseUrl, "/api/orders/next-code", {
      headers: authHeaders
    });
    assert.match(secondCode.payload.code, /^TAHA-\d{8}-002$/);
    await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "tiktok",
        orders: [{
          orderCode: secondCode.payload.code,
          platformFee: "21,000",
          items: [{
            categoryId: categories["Giày"].id,
            code: "GIAY-TEST-01",
            quantity: 1,
            salePrice: "210,000"
          }]
        }]
      })
    });
    const secondOrder = (await request(baseUrl, "/api/orders", {
      headers: authHeaders
    })).payload.find((order) => order.orderCode === secondCode.payload.code);
    const returned = await request(baseUrl, `/api/orders/${secondOrder.id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "returned" })
    });
    assert.equal(returned.payload.revenue, 0);
    assert.equal(returned.payload.platformFee, 0);
    assert.equal(returned.payload.cogs, 0);
    assert.equal(returned.payload.profit, 0);

    products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    assert.equal(stockOf("GIAY-TEST-01"), 14);
    assert.equal(stockOf("VO-MD"), 18);
    assert.equal(stockOf("GIAY-IN-MD"), 499);

    await request(baseUrl, `/api/orders/${secondOrder.id}/status`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({ status: "returned" })
    });
    products = (await request(baseUrl, "/api/products", { headers: authHeaders })).payload;
    assert.equal(stockOf("GIAY-TEST-01"), 14, "không được hoàn kho hai lần");

    await assert.rejects(
      request(baseUrl, "/api/sales", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          channel: "facebook",
          orders: [{
            shippingFee: 30000,
            items: [{
              categoryId: categories["Xịt khử mùi"].id,
              code: "XIT-MD",
              quantity: 1,
              salePrice: 50000
            }]
          }]
        })
      }),
      /Tên khách hàng không được để trống/
    );

    const directSale = await request(baseUrl, "/api/sales", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        channel: "facebook",
        orders: [{
          orderCode: "KHONG-DUOC-DUNG-MA-NAY",
          platformFee: 999999,
          shippingFee: "30,000",
          customerName: "Nguyễn Văn Khách",
          customerPhone: "0901.234.567",
          customerAddress: "123 Đường Kiểm Thử, Cần Thơ",
          items: [{
            categoryId: categories["Xịt khử mùi"].id,
            code: "XIT-MD",
            quantity: 1,
            salePrice: "50,000"
          }]
        }]
      })
    });
    assert.match(directSale.payload.orderCodes[0], /^TAHA-\d{8}-003$/);
    assert.notEqual(directSale.payload.orderCodes[0], "KHONG-DUOC-DUNG-MA-NAY");
    const directOrder = (await request(baseUrl, "/api/orders", {
      headers: authHeaders
    })).payload.find((order) => order.orderCode === directSale.payload.orderCodes[0]);
    assert.equal(directOrder.channel, "facebook");
    assert.equal(directOrder.customerName, "Nguyễn Văn Khách");
    assert.equal(directOrder.customerPhone, "0901234567");
    assert.equal(directOrder.customerAddress, "123 Đường Kiểm Thử, Cần Thơ");
    assert.equal(directOrder.platformFee, 0);
    assert.equal(directOrder.shippingFee, 30000);
    assert.equal(directOrder.sellingFee, 30000);
    assert.equal(directOrder.revenue, 50000);
    assert.equal(directOrder.cogs, 6000);
    assert.equal(directOrder.profit, 14000);

    const dashboardWithDirectOrder = (await request(baseUrl, "/api/dashboard", {
      headers: authHeaders
    })).payload;
    assert.equal(dashboardWithDirectOrder.revenue, 470000);
    assert.equal(dashboardWithDirectOrder.platformFees, 42000);
    assert.equal(dashboardWithDirectOrder.shippingFees, 30000);
    assert.equal(dashboardWithDirectOrder.sellingFees, 72000);
    assert.equal(dashboardWithDirectOrder.cogs, 312200);
    assert.equal(dashboardWithDirectOrder.profit, 85800);

    const today = new Date();
    const reportAnchor = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0")
    ].join("-");
    for (const period of ["day", "week", "month", "quarter", "year"]) {
      const report = await request(
        baseUrl,
        `/api/reports?period=${period}&anchor=${reportAnchor}`,
        { headers: authHeaders }
      );
      assert.equal(report.payload.range.period, period);
      assert.equal(report.payload.orders.length, 3);
    }
    const quarterReport = (await request(
      baseUrl,
      `/api/reports?period=quarter&anchor=${reportAnchor}`,
      { headers: authHeaders }
    )).payload;
    const quarterStartMonth = String(Math.floor(today.getMonth() / 3) * 3 + 1).padStart(2, "0");
    assert.equal(quarterReport.range.startDate, `${today.getFullYear()}-${quarterStartMonth}-01`);
    const yearReport = (await request(
      baseUrl,
      `/api/reports?period=year&anchor=${reportAnchor}`,
      { headers: authHeaders }
    )).payload;
    assert.equal(yearReport.range.startDate, `${today.getFullYear()}-01-01`);
    assert.equal(yearReport.range.endDate, `${today.getFullYear()}-12-31`);
    assert.equal(yearReport.totals.orders, 2, "đơn trả hàng không tính vào tổng hiệu quả");

    const excelResponse = await fetch(
      `${baseUrl}/api/reports/export?period=year&anchor=${reportAnchor}&format=xlsx`,
      { headers: authHeaders }
    );
    assert.equal(excelResponse.status, 200);
    assert.match(
      excelResponse.headers.get("content-type"),
      /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/
    );
    assert.match(excelResponse.headers.get("content-disposition"), /\.xlsx"$/);
    const excelBuffer = Buffer.from(await excelResponse.arrayBuffer());
    assert.equal(excelBuffer.subarray(0, 2).toString(), "PK");
    assert.ok(excelBuffer.length > 7000);
    const exportedWorkbook = new ExcelJS.Workbook();
    await exportedWorkbook.xlsx.load(excelBuffer);
    assert.deepEqual(exportedWorkbook.worksheets.map((sheet) => sheet.name), [
      "Tổng quan",
      "Đơn hàng"
    ]);
    assert.equal(exportedWorkbook.getWorksheet("Tổng quan").getCell("A1").value, "BÁO CÁO BÁN HÀNG - TAHA SHOES");
    assert.equal(exportedWorkbook.getWorksheet("Tổng quan").getCell("A6").value.result, 2);
    assert.equal(exportedWorkbook.getWorksheet("Đơn hàng").rowCount, 4);

    const pdfResponse = await fetch(
      `${baseUrl}/api/reports/export?period=year&anchor=${reportAnchor}&format=pdf`,
      { headers: authHeaders }
    );
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get("content-type"), /application\/pdf/);
    assert.match(pdfResponse.headers.get("content-disposition"), /\.pdf"$/);
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    assert.equal(pdfBuffer.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdfBuffer.length > 5000);
    const artifactDirectory = process.env.REPORT_ARTIFACT_DIR;
    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true });
      writeFileSync(join(artifactDirectory, "bao-cao-kiem-thu.xlsx"), excelBuffer);
      writeFileSync(join(artifactDirectory, "bao-cao-kiem-thu.pdf"), pdfBuffer);
    }

    const invalidExport = await fetch(
      `${baseUrl}/api/reports/export?period=year&anchor=${reportAnchor}&format=csv`,
      { headers: authHeaders }
    );
    assert.equal(invalidExport.status, 400);
    const unauthenticatedExport = await fetch(
      `${baseUrl}/api/reports/export?period=year&anchor=${reportAnchor}&format=pdf`
    );
    assert.equal(unauthenticatedExport.status, 401);

    const manager = await request(baseUrl, "/api/managers", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "Quản lý kiểm thử",
        phone: "0911111111",
        password: "Manager@1"
      })
    });
    assert.equal(manager.payload.role, "manager");
    const managerLogin = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone: "0911111111", password: "Manager@1" })
    });
    const managerCookie = managerLogin.response.headers.get("set-cookie").split(";")[0];
    const forbiddenPurge = await fetch(`${baseUrl}/api/admin/operational-data`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: managerCookie },
      body: JSON.stringify({
        password: "Manager@1",
        confirmation: "DELETE_OPERATIONAL_DATA"
      })
    });
    assert.equal(forbiddenPurge.status, 403, "quản lý không được phép xóa dữ liệu");

    await assert.rejects(
      request(baseUrl, "/api/admin/operational-data", {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({
          password: "SaiMatKhau@1",
          confirmation: "DELETE_OPERATIONAL_DATA"
        })
      }),
      /Mật khẩu admin không đúng/
    );
    const purged = await request(baseUrl, "/api/admin/operational-data", {
      method: "DELETE",
      headers: authHeaders,
      body: JSON.stringify({
        password: "Admin@123",
        confirmation: "DELETE_OPERATIONAL_DATA"
      })
    });
    assert.equal(purged.payload.deleted.products, 6);
    assert.equal(purged.payload.deleted.orders, 3);
    assert.equal(purged.payload.categoriesPreserved, 7);
    assert.deepEqual(
      (await request(baseUrl, "/api/products", { headers: authHeaders })).payload,
      []
    );
    assert.deepEqual(
      (await request(baseUrl, "/api/orders", { headers: authHeaders })).payload,
      []
    );
    assert.deepEqual(
      (await request(baseUrl, "/api/transactions", { headers: authHeaders })).payload,
      []
    );
    assert.equal(
      (await request(baseUrl, "/api/categories", { headers: authHeaders })).payload.length,
      7,
      "xóa dữ liệu không được xóa danh mục"
    );
    assert.equal(
      (await request(baseUrl, "/api/managers", { headers: authHeaders })).payload.length,
      1,
      "xóa dữ liệu không được xóa tài khoản quản lý"
    );
    assert.equal(
      (await request(baseUrl, "/api/auth/me", { headers: authHeaders })).payload.role,
      "admin",
      "phiên admin hiện tại phải được giữ lại"
    );
    assert.match(
      (await request(baseUrl, "/api/orders/next-code", { headers: authHeaders })).payload.code,
      /^TAHA-\d{8}-001$/
    );

    const database = new DatabaseSync(databasePath);
    assert.match(
      database.prepare(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales_orders'
      `).get().sql,
      /'delivered'/,
      "schema đơn hàng cũ phải được nâng cấp để hỗ trợ trạng thái đã giao"
    );
    const salesOrderColumns = database.prepare("PRAGMA table_info(sales_orders)").all()
      .map((column) => column.name);
    assert.ok(salesOrderColumns.includes("shipping_fee"));
    assert.ok(salesOrderColumns.includes("customer_name"));
    assert.ok(salesOrderColumns.includes("customer_phone"));
    assert.ok(salesOrderColumns.includes("customer_address"));
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM app_meta WHERE key = ?").get(
        "operational_data_reset_2026_08_03_v2"
      ).count,
      1
    );
    database.close();
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
