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
const authorizeBlock = yaml.slice(yaml.indexOf("  /customer/oauth/authorize:"), yaml.indexOf("  /customer/oauth/token:"));
const requiredAuthorizeParameters = ["response_type", "client_id", "redirect_uri", "state", "nonce", "code_challenge", "code_challenge_method"];
const authorizeRequired = requiredAuthorizeParameters.every((name) => new RegExp(`- name: ${name}\\n\\s+in: query\\n\\s+required: true`).test(authorizeBlock));

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
  [operationIds.length === 48 && new Set(operationIds).size === operationIds.length, "Storefront OpenAPI operationId listesi eksik veya yineleniyor"],
  [yaml.includes("ProductConnectionResponse:") && yaml.includes("CatalogFacets:") && yaml.includes("PromotionListResponse:"), "Typed katalog/facet/promosyon şemaları eksik"],
  [yaml.includes("ShopIdentity:") && yaml.includes("StorefrontIdentity:") && yaml.includes("StorefrontBranding:") && yaml.includes("StorefrontSeo:"), "Dinamik mağaza kimliği ve marka şemaları eksik"],
  [yaml.includes("canonicalOrigin:") && yaml.includes("platformDomain:") && yaml.includes("supportedLocales:") && yaml.includes("domainStatus:"), "Domain ve locale sözleşmesi güçlü biçimde belgelenmedi"],
  [yaml.includes("name: color") && yaml.includes("name: size") && yaml.includes("name: priceMin") && yaml.includes("name: priceMax"), "Katalog filtre parametreleri eksik"],
  [yaml.includes("/localization:") && yaml.includes("/promotions:") && yaml.includes("/blogs/{blogHandle}/{postHandle}:"), "Yeni tema veri uçları belgelenmedi"],
  [html.includes('id="theme-coverage"') && html.includes("Koleksiyon filtreleri") && html.includes("Fiyat ve kampanya"), "Tema geliştirme kapsamı ve örnekleri eksik"],
  [html.includes("overflow-x:hidden") && html.includes("minmax(0,1fr)") && html.includes("overflow-wrap:anywhere"), "Doküman yatay taşma koruması eksik"],
  [html.includes("data-resource-toggle") && html.includes("applySearch"), "Storefront kaynak aç/kapat veya arama etkileşimi eksik"],
  [pathKeys.length === new Set(pathKeys).size, "Storefront OpenAPI aynı path anahtarını birden fazla kez üretiyor"],
  [(yaml.match(/^  \/customer:$/gm) || []).length === 1 && yaml.includes("      operationId: getStorefrontCustomer") && yaml.includes("      operationId: mutateStorefrontCustomer"), "GET ve POST customer işlemleri aynı OpenAPI path nesnesinde birleşmeli"],
  [yaml.includes("/checkout-sessions:") && yaml.includes("Idempotency-Key") && yaml.includes("storefront:checkout"), "Headless checkout sözleşmesi eksik"],
  [yaml.includes("/customer/oauth/authorize:") && yaml.includes("code_challenge_method") && yaml.includes("CustomerOAuthBearer"), "Müşteri PKCE OAuth sözleşmesi eksik"],
  [authorizeRequired, "OAuth authorize zorunlu parametreleri OpenAPI'de required değil"],
  [yaml.includes("required: [id, email, acceptsMarketingEmail, emailVerified]") && yaml.includes("emailVerified: { type: boolean }"), "Customer profile yanıt alanları typed değil"],
  [yaml.includes("/newsletter-subscriptions:") && yaml.includes("NewsletterSubscriptionRequest") && yaml.includes("'202':"), "Newsletter double opt-in sözleşmesi eksik"],
  [yaml.includes("/contact-us:") && yaml.includes("ContactRequest:") && yaml.includes("ContactAcceptedResponse:") && yaml.includes("orderNumber:") && yaml.includes("PayloadTooLarge:") && yaml.includes("UnsupportedMediaType:"), "Güvenli iletişim formu sözleşmesi eksik"],
  [yaml.includes("varyant SKU ve seçeneklerinde") && yaml.includes("Unicode, büyük/küçük harf ve aksan"), "Normalize Storefront arama kapsamı belgelenmedi"],
  [yaml.includes("operationId: listPublishedProductReviews") && yaml.includes("ReviewConnectionResponse:") && yaml.includes("highest_rating") && yaml.includes("name: cursor"), "Onaylı yorum listeleme sözleşmesi eksik"],
  [yaml.includes("StorefrontPublicSettings:") && yaml.includes("StorefrontSocialLink:") && yaml.includes("StorefrontCommerceDisplay:") && yaml.includes("StorefrontPaymentBrand:"), "Shop sunum ayarları açık tiplerle belgelenmedi"],
  [yaml.includes("StorefrontCheckoutConfig:") && yaml.includes("providerKey: { type: string, enum: [shopify-checkout, payment-paytr, payment-iyzico] }") && yaml.includes("required: [shop, storefront, branding, seo, settings, localization, promotions, checkout]"), "Shop ödeme sağlayıcısı keşif sözleşmesi belgelenmedi"],
  [yaml.includes("MetafieldEntry:") && yaml.includes("metafieldEntries:") && yaml.includes("name: include") && yaml.includes("enum: [\"metafields\"]"), "Storefront metafield projection sözleşmesi belgelenmedi"],
  [yaml.includes("variantIds:") && yaml.includes("product_images.variant_ids"), "Varyant-görsel atama sözleşmesi belgelenmedi"],
  [yaml.includes("x-shopiyz-cache-control: public, max-age=60, s-maxage=300, stale-while-revalidate=600"), "Yorum cache sözleşmesi belgelenmedi"],
  [yaml.includes("MethodNotAllowed:") && yaml.includes("Allow:") && yaml.includes("'405':"), "JSON 405 ve Allow sözleşmesi belgelenmedi"],
  [yaml.includes("aggregate: { averageRating: 0, reviewCount: 0") && yaml.includes("commerceDisplay: { freeShippingThreshold: null, paymentBrands: [] }"), "Storefront empty-state örnekleri eksik"],
  [yaml.includes("'409':") && yaml.includes("'422':") && yaml.includes("ErrorResponse:"), "Yeni Storefront hata şemaları eksik"],
  [html.includes('id="headless-security"') && html.includes("React PKCE özeti") && html.includes("İletişim formu") && html.includes("Tehdit modeli"), "Headless örnekleri ve tehdit modeli eksik"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  process.exit(1);
}
console.log(`Storefront API docs validation passed (${checks.length} checks).`);
