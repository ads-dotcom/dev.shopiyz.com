import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("public/storefront.html");
const admin = read("public/index.html");
const yaml = read("public/openapi/shopiyz-storefront-api.yaml");
const operationIds = Array.from(yaml.matchAll(/^      operationId: (\S+)$/gm), (match) => match[1]);
const pathKeys = Array.from(yaml.matchAll(/^  (\/[^:]+):$/gm), (match) => match[1]);

const checks = [
  [admin.includes('href="./storefront.html">Storefront API</a>'), "Admin API sayfasında Storefront API sekmesi yok"],
  [html.includes('class="active" href="./storefront.html">Storefront API</a>'), "Storefront API sekmesi aktif değil"],
  [html.includes("Temalar için tek, hızlı ve güvenli veri sözleşmesi"), "Storefront mimari açıklaması yok"],
  [yaml.includes("title: Shopiyz Storefront API"), "Storefront OpenAPI başlığı yok"],
  [yaml.includes("/page:"), "Page runtime endpointi belgelenmedi"],
  [yaml.includes("/products/{handle}:"), "Ürün detay endpointi belgelenmedi"],
  [yaml.includes("/collections/{handle}:"), "Koleksiyon endpointi belgelenmedi"],
  [yaml.includes("/customer:"), "Müşteri endpointi belgelenmedi"],
  [yaml.includes("bearerFormat: shpft"), "Storefront token formatı belgelenmedi"],
  [yaml.includes("storefront:read"), "Storefront scope belgelenmedi"],
  [operationIds.length === 32 && new Set(operationIds).size === operationIds.length, "Storefront OpenAPI operationId listesi eksik veya yineleniyor"],
  [pathKeys.length === new Set(pathKeys).size, "Storefront OpenAPI aynı path anahtarını birden fazla kez üretiyor"],
  [(yaml.match(/^  \/customer:$/gm) || []).length === 1 && yaml.includes("      operationId: getStorefrontCustomer") && yaml.includes("      operationId: mutateStorefrontCustomer"), "GET ve POST customer işlemleri aynı OpenAPI path nesnesinde birleşmeli"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  process.exit(1);
}
console.log(`Storefront API docs validation passed (${checks.length} checks).`);
