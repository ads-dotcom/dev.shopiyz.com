import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const html = read("public/storefront.html");
const admin = read("public/admin.html");
const yaml = read("public/openapi/shopiyz-storefront-api.yaml");
const operationIds = Array.from(yaml.matchAll(/^      operationId: (\S+)$/gm), (match) => match[1]);
const pathKeys = Array.from(yaml.matchAll(/^  (\/[^:]+):$/gm), (match) => match[1]);

const checks = [
  [admin.includes('href="/storefront">Storefront API</a>') && admin.includes('class="active" href="/admin">Admin API</a>'), "Admin API sayfasının kanonik navigasyonu yok"],
  [html.includes('href="/admin">Admin API</a>') && html.includes('class="active" href="/storefront">Storefront API</a>'), "Storefront/Admin API sekme linkleri kanonik değil"],
  [html.includes('href="/openapi">OpenAPI</a>'), "Storefront üst navigasyonu birleşik OpenAPI merkezine gitmiyor"],
  [html.includes("Temalar için hızlı, güvenli ve tutarlı veri katmanı"), "Storefront mimari açıklaması yok"],
  [html.includes('class="top-search"') && html.includes('class="notice"') && html.includes('class="code-surface"'), "Storefront sayfası Admin API tasarım sistemi bileşenlerini kullanmıyor"],
  [yaml.includes("title: Shopiyz Storefront API"), "Storefront OpenAPI başlığı yok"],
  [yaml.includes("/page:"), "Page runtime endpointi belgelenmedi"],
  [yaml.includes("/products/{handle}:"), "Ürün detay endpointi belgelenmedi"],
  [yaml.includes("/collections/{handle}:"), "Koleksiyon endpointi belgelenmedi"],
  [yaml.includes("/customer:"), "Müşteri endpointi belgelenmedi"],
  [yaml.includes("bearerFormat: shpft"), "Storefront token formatı belgelenmedi"],
  [yaml.includes("storefront:read"), "Storefront scope belgelenmedi"],
  [operationIds.length === 38 && new Set(operationIds).size === operationIds.length, "Storefront OpenAPI operationId listesi eksik veya yineleniyor"],
  [yaml.includes("ProductConnectionResponse:") && yaml.includes("CatalogFacets:") && yaml.includes("PromotionListResponse:"), "Typed katalog/facet/promosyon şemaları eksik"],
  [yaml.includes("name: color") && yaml.includes("name: size") && yaml.includes("name: priceMin") && yaml.includes("name: priceMax"), "Katalog filtre parametreleri eksik"],
  [yaml.includes("/localization:") && yaml.includes("/promotions:") && yaml.includes("/blogs/{blogHandle}/{postHandle}:"), "Yeni tema veri uçları belgelenmedi"],
  [html.includes('id="theme-coverage"') && html.includes("Koleksiyon filtreleri") && html.includes("Fiyat ve kampanya"), "Tema geliştirme kapsamı ve örnekleri eksik"],
  [html.includes("overflow-x:hidden") && html.includes("minmax(0,1fr)") && html.includes("overflow-wrap:anywhere"), "Doküman yatay taşma koruması eksik"],
  [html.includes("data-resource-toggle") && html.includes("applySearch"), "Storefront kaynak aç/kapat veya arama etkileşimi eksik"],
  [pathKeys.length === new Set(pathKeys).size, "Storefront OpenAPI aynı path anahtarını birden fazla kez üretiyor"],
  [(yaml.match(/^  \/customer:$/gm) || []).length === 1 && yaml.includes("      operationId: getStorefrontCustomer") && yaml.includes("      operationId: mutateStorefrontCustomer"), "GET ve POST customer işlemleri aynı OpenAPI path nesnesinde birleşmeli"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  process.exit(1);
}
console.log(`Storefront API docs validation passed (${checks.length} checks).`);
