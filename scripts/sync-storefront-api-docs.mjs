import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");
const appRoot = path.resolve(process.env.SHOPIYZ_APP_REPO || path.join(docsRoot, "..", "myshopiyz"));
const catalogEntry = path.join(appRoot, "src", "lib", "storefrontApiCatalog.ts");
const esbuildBin = path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const yamlString = (value) => JSON.stringify(String(value ?? ""));
const slug = (value) => String(value || "resource").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const loadCatalog = async () => {
  if (!fs.existsSync(catalogEntry)) throw new Error(`Storefront API catalog bulunamadı: ${catalogEntry}`);
  if (!fs.existsSync(esbuildBin)) throw new Error(`esbuild bulunamadı: ${esbuildBin}`);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopiyz-storefront-docs-"));
  const bundle = path.join(tempDir, "catalog.mjs");
  try {
    execFileSync(esbuildBin, [catalogEntry, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`], { stdio: "pipe" });
    const module = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
    return module.buildStorefrontApiCatalogPayload();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const operationSecurity = (operation) => {
  if (operation.auth === "public") return ["      security: []"];
  if (operation.auth === "same_origin") return ["      security:", "        - StorefrontSession: []"];
  return ["      security:", "        - {}", "        - StorefrontAccessToken: []", "        - StorefrontBearerAuth: []"];
};

const queryParameters = (operation) => {
  const names = [];
  if (operation.method === "GET" && !["/health", "/image"].includes(operation.path)) names.push("storeId", "preview", "previewThemeId", "designId");
  if (operation.path === "/page") names.push("pageType", "path", "product", "collection", "blog", "blogPost", "page", "policy", "limit");
  if (operation.path === "/products" || operation.path.startsWith("/collections/{")) names.push("page", "limit", "sort", "vendor", "productType", "category", "tag", "color", "size", "availability", "priceMin", "priceMax");
  if (operation.path === "/search") names.push("q", "searchPage", "limit", "searchSort", "searchType", "searchVendor", "searchCategory", "searchProductType", "searchColor", "searchSize", "searchAvailability", "searchPriceMax");
  if (["/smart-search", "/quick-view-product", "/product-viewers", "/cart-recovery-cart", "/image"].includes(operation.path)) names.push("storeId");
  if (operation.path === "/image") names.push("source", "width", "quality", "format");
  if (operation.path === "/smart-search") names.push("q", "limit", "sessionId", "deviceType");
  if (operation.path === "/quick-view-product") names.push("product", "products", "preview", "revision");
  if (operation.path === "/product-viewers") names.push("productId", "productHandle", "windowSeconds");
  if (operation.path === "/cart-recovery-cart") names.push("cartToken");
  return Array.from(new Set(names));
};

const parameterDetails = {
  storeId: { type: "string", description: "Yalnız development/preview ortamında açık mağaza kimliği." },
  preview: { type: "boolean", description: "Yetkili aynı-origin oturumunda taslak içerik ön izlemesi." },
  previewThemeId: { type: "string", description: "Ön izlenecek kurulu tema kimliği." },
  designId: { type: "string", description: "Ön izlenecek tema düzeni kimliği." },
  pageType: { type: "string", description: "home, product, collection, collection-list, search, page, blog-category veya blog-post." },
  path: { type: "string", description: "Tarayıcıdaki kanonik storefront yolu." },
  product: { type: "string", description: "Ürün handle veya kimliği." },
  collection: { type: "string", description: "Koleksiyon handle veya kimliği." },
  blog: { type: "string", description: "Blog handle." },
  blogPost: { type: "string", description: "Blog yazısı handle." },
  policy: { type: "string", description: "Politika handle." },
  page: { type: "integer", minimum: 1, description: "Birden başlayan sonuç sayfası." },
  limit: { type: "integer", minimum: 1, maximum: 48, description: "Sayfa başına sonuç; en fazla 48." },
  sort: { type: "string", enum: ["default", "title-asc", "title-desc", "newest", "oldest", "price-asc", "price-desc"], description: "Katalog sıralaması." },
  vendor: { type: "string", description: "Virgülle ayrılmış veya tekrarlanan marka değerleri." },
  productType: { type: "string", description: "Virgülle ayrılmış veya tekrarlanan ürün tipi değerleri." },
  category: { type: "string", description: "Virgülle ayrılmış veya tekrarlanan kategori değerleri." },
  tag: { type: "string", description: "Virgülle ayrılmış veya tekrarlanan etiket değerleri." },
  color: { type: "string", description: "Varyant renk seçeneği; Color, Colour, Renk, Farbe ve Couleur adları tanınır." },
  size: { type: "string", description: "Varyant beden seçeneği; Size, Beden, Größe ve Taille adları tanınır." },
  availability: { type: "string", enum: ["in-stock", "out-of-stock", "preorder"], description: "Satılabilirlik filtresi." },
  priceMin: { type: "number", minimum: 0, description: "Mağaza para biriminde minimum fiyat." },
  priceMax: { type: "number", minimum: 0, description: "Mağaza para biriminde maksimum fiyat." },
  q: { type: "string", description: "Arama metni." },
  searchPage: { type: "integer", minimum: 1, description: "Arama sonuç sayfası." },
  searchSort: { type: "string", enum: ["relevance", "title", "newest", "price-asc", "price-desc"], description: "Arama sıralaması." },
  searchType: { type: "string", enum: ["all", "products", "collections", "pages", "blog_posts"], description: "Arama sonuç türü." },
  searchVendor: { type: "string", description: "Arama marka filtresi." },
  searchCategory: { type: "string", description: "Arama kategori filtresi." },
  searchProductType: { type: "string", description: "Arama ürün tipi filtresi." },
  searchColor: { type: "string", description: "Arama renk filtresi." },
  searchSize: { type: "string", description: "Arama beden filtresi." },
  searchAvailability: { type: "boolean", description: "Yalnız stokta satılabilir ürünler." },
  searchPriceMax: { type: "number", minimum: 0, description: "Arama maksimum fiyatı." },
  source: { type: "string", description: "İzin verilen kaynak görsel URL'si." },
  width: { type: "integer", minimum: 1, description: "Dönüştürülen görsel genişliği." },
  quality: { type: "integer", minimum: 1, maximum: 100, description: "Görsel kalite yüzdesi." },
  format: { type: "string", enum: ["auto", "avif", "webp", "jpeg", "png"], description: "Çıktı formatı." },
  sessionId: { type: "string", description: "Anonim arama oturumu." },
  deviceType: { type: "string", description: "İstemci cihaz sınıfı." },
  products: { type: "string", description: "Virgülle ayrılmış ürün kimlikleri." },
  revision: { type: "string", description: "Storefront cache revision." },
  productId: { type: "string", description: "Ürün kimliği." },
  productHandle: { type: "string", description: "Ürün handle." },
  windowSeconds: { type: "integer", minimum: 30, description: "Aktif izleyici zaman penceresi." },
  cartToken: { type: "string", description: "Tek kullanımlık sepet kurtarma belirteci." },
};

const responseSchemaFor = (operation) => {
  if (operation.path === "/page") return "StorefrontPageResponse";
  if (operation.path === "/shop") return "ShopResponse";
  if (operation.path === "/localization") return "LocalizationResponse";
  if (operation.path === "/products") return "ProductConnectionResponse";
  if (operation.path === "/products/{handle}") return "ProductResponse";
  if (operation.path === "/collections") return "CollectionListResponse";
  if (operation.path === "/collections/{handle}") return "CollectionResponse";
  if (operation.path === "/menus") return "MenuListResponse";
  if (operation.path === "/promotions") return "PromotionListResponse";
  if (operation.path === "/pages/{handle}") return "ContentPageResponse";
  if (operation.path === "/blogs") return "BlogListResponse";
  if (operation.path === "/blogs/{handle}") return "BlogResponse";
  if (operation.path === "/blogs/{blogHandle}/{postHandle}") return "BlogPostResponse";
  if (operation.path === "/search") return "SearchResponse";
  return "StorefrontResponse";
};

const renderOpenApi = (catalog) => {
  const lines = [
    "openapi: 3.1.0",
    "info:",
    "  title: Shopiyz Storefront API",
    `  version: ${yamlString(catalog.version)}`,
    "  description: |-",
    "    Versioned, read-optimized storefront contract used by Shopiyz themes and headless clients.",
    "    First-party same-origin themes may read public endpoints without a token. Cross-origin clients use a storefront token with storefront:read.",
    "servers:",
    `  - url: https://{store}.myshopiyz.com${catalog.basePath}`,
    "    variables:",
    "      store:",
    "        default: development",
    "        description: Store subdomain or custom store hostname.",
    `x-shopiyz-base-path: ${yamlString(catalog.basePath)}`,
    `x-shopiyz-generated-at: ${yamlString(catalog.generatedAt)}`,
    "paths:",
  ];
  const operationsByPath = new Map();
  for (const operation of catalog.operations) {
    const current = operationsByPath.get(operation.path) || [];
    current.push(operation);
    operationsByPath.set(operation.path, current);
  }
  for (const [apiPath, operations] of operationsByPath) {
    lines.push(`  ${apiPath}:`);
    for (const operation of operations) {
      lines.push(`    ${operation.method.toLowerCase()}:`);
      lines.push(`      operationId: ${operation.operationId}`);
      lines.push(`      summary: ${yamlString(operation.summary)}`);
      lines.push(`      description: ${yamlString(operation.description)}`);
      lines.push(`      tags: [${yamlString(operation.resourceName)}]`);
      lines.push(`      x-shopiyz-auth: ${operation.auth}`);
      lines.push(`      x-shopiyz-cache: ${operation.cache}`);
      if (operation.scope) lines.push(`      x-required-scopes: [${yamlString(operation.scope)}]`);
      const pathParams = Array.from(operation.path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
      const queryParams = queryParameters(operation);
      if (pathParams.length || queryParams.length) {
        lines.push("      parameters:");
        for (const name of pathParams) {
          lines.push(`        - name: ${name}`, "          in: path", "          required: true", "          schema: { type: string }");
        }
        for (const name of queryParams) {
          const detail = name === "page" && operation.path === "/page"
            ? { type: "string", description: "İçerik sayfası handle." }
            : parameterDetails[name] || { type: "string", description: `${name} query parametresi.` };
          const schemaParts = [`type: ${detail.type}`];
          if (detail.minimum !== undefined) schemaParts.push(`minimum: ${detail.minimum}`);
          if (detail.maximum !== undefined) schemaParts.push(`maximum: ${detail.maximum}`);
          if (detail.enum) schemaParts.push(`enum: [${detail.enum.map(yamlString).join(", ")}]`);
          lines.push(
            `        - name: ${name}`,
            "          in: query",
            "          required: false",
            `          description: ${yamlString(detail.description)}`,
            `          schema: { ${schemaParts.join(", ")} }`,
          );
        }
      }
      if (operation.method === "POST") {
        lines.push("      requestBody:", "        required: true", "        content:", "          application/json:", "            schema:", "              type: object", "              additionalProperties: true");
      }
      lines.push("      responses:", "        '200':", "          description: Successful Storefront response", "          content:", "            application/json:", "              schema:", `                $ref: '#/components/schemas/${responseSchemaFor(operation)}'`, "        '400':", "          $ref: '#/components/responses/BadRequest'", "        '401':", "          $ref: '#/components/responses/Unauthorized'", "        '403':", "          $ref: '#/components/responses/Forbidden'", "        '404':", "          $ref: '#/components/responses/NotFound'", "        '429':", "          $ref: '#/components/responses/RateLimited'", "        '500':", "          $ref: '#/components/responses/InternalError'");
      lines.push(...operationSecurity(operation));
    }
  }
  lines.push(
    "components:",
    "  securitySchemes:",
    "    StorefrontAccessToken:",
    "      type: apiKey",
    "      in: header",
    "      name: X-Shopiyz-Storefront-Access-Token",
    "    StorefrontBearerAuth:",
    "      type: http",
    "      scheme: bearer",
    "      bearerFormat: shpft",
    "    StorefrontSession:",
    "      type: apiKey",
    "      in: cookie",
    "      name: faprika_session",
    "  schemas:",
    "    StorefrontResponse:",
    "      type: object",
    "      additionalProperties: true",
    "    StorefrontMeta:",
    "      type: object",
    "      properties:",
    "        apiVersion: { type: string }",
    "        storefrontRevision: { type: [string, 'null'] }",
    "    Localization:",
    "      type: object",
    "      required: [currency, locale, currencySymbol, minimumFractionDigits, maximumFractionDigits, markets, availableCountries]",
    "      properties:",
    "        currency: { type: string, pattern: '^[A-Z]{3}$' }",
    "        locale: { type: string }",
    "        currencySymbol: { type: string }",
    "        minimumFractionDigits: { type: integer, minimum: 0 }",
    "        maximumFractionDigits: { type: integer, minimum: 0 }",
    "        timezone: { type: string }",
    "        markets:",
    "          type: array",
    "          items:",
    "            type: object",
    "            required: [id, name, countries, currency]",
    "            properties:",
    "              id: { type: string }",
    "              name: { type: string }",
    "              countries: { type: array, items: { type: string, pattern: '^[A-Z]{2}$' } }",
    "              currency: { type: string, pattern: '^[A-Z]{3}$' }",
    "        availableCountries: { type: array, items: { type: string, pattern: '^[A-Z]{2}$' } }",
    "    ProductVariant:",
    "      type: object",
    "      required: [id, productId, price, inventoryQuantity, availableForSale]",
    "      properties:",
    "        id: { type: string }",
    "        productId: { type: string }",
    "        title: { type: [string, 'null'] }",
    "        sku: { type: [string, 'null'] }",
    "        price: { type: number, minimum: 0 }",
    "        compareAtPrice: { type: [number, 'null'], minimum: 0 }",
    "        inventoryQuantity: { type: integer }",
    "        availableForSale: { type: boolean }",
    "        optionValues: { type: array, items: { type: string } }",
    "        imageUrl: { type: [string, 'null'], format: uri-reference }",
    "      description: Maliyet değeri Storefront yanıtında null olarak maskelenir; tedarikçi maliyet verisi yayınlanmaz.",
    "    ProductImage:",
    "      type: object",
    "      required: [id, url, mediaType, position]",
    "      properties:",
    "        id: { type: string }",
    "        url: { type: string, format: uri-reference }",
    "        altText: { type: [string, 'null'] }",
    "        mediaType: { type: string }",
    "        position: { type: integer }",
    "        width: { type: [integer, 'null'] }",
    "        height: { type: [integer, 'null'] }",
    "    Product:",
    "      type: object",
    "      required: [id, title, handle, status, tags, minPrice, maxPrice, inventoryQuantity]",
    "      properties:",
    "        id: { type: string }",
    "        title: { type: string }",
    "        handle: { type: string }",
    "        status: { type: string, enum: [active] }",
    "        vendor: { type: [string, 'null'] }",
    "        productType: { type: [string, 'null'] }",
    "        productCategory: { type: [string, 'null'] }",
    "        description: { type: [string, 'null'] }",
    "        tags: { type: array, items: { type: string } }",
    "        featuredImageUrl: { type: [string, 'null'], format: uri-reference }",
    "        availableForSale: { type: boolean }",
    "        preorderOnly: { type: boolean }",
    "        inventoryQuantity: { type: integer }",
    "        minPrice: { type: number, minimum: 0 }",
    "        maxPrice: { type: number, minimum: 0 }",
    "        minCompareAtPrice: { type: [number, 'null'], minimum: 0 }",
    "        optionNames: { type: array, items: { type: string } }",
    "        variants: { type: array, items: { $ref: '#/components/schemas/ProductVariant' } }",
    "        images: { type: array, items: { $ref: '#/components/schemas/ProductImage' } }",
    "        metafields: { type: object, additionalProperties: true }",
    "      additionalProperties: true",
    "    Collection:",
    "      type: object",
    "      required: [id, title, slug, status, productCount]",
    "      properties:",
    "        id: { type: string }",
    "        title: { type: string }",
    "        slug: { type: string }",
    "        status: { type: string, enum: [active] }",
    "        description: { type: [string, 'null'] }",
    "        imageUrl: { type: [string, 'null'], format: uri-reference }",
    "        productCount: { type: integer, minimum: 0 }",
    "        sortOrder: { type: string }",
    "      additionalProperties: true",
    "    FacetValue:",
    "      type: object",
    "      required: [value, count]",
    "      properties:",
    "        value: { type: string }",
    "        count: { type: integer, minimum: 0 }",
    "    CatalogFacets:",
    "      type: object",
    "      required: [vendors, productTypes, categories, tags, colors, sizes, availability, price]",
    "      properties:",
    "        vendors: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        productTypes: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        categories: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        tags: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        colors: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        sizes: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        availability: { type: array, items: { $ref: '#/components/schemas/FacetValue' } }",
    "        price:",
    "          type: object",
    "          properties:",
    "            minimum: { type: number, minimum: 0 }",
    "            maximum: { type: number, minimum: 0 }",
    "    Pagination:",
    "      type: object",
    "      required: [page, limit, total, unfilteredTotal, pageCount, hasPreviousPage, hasNextPage, capped]",
    "      properties:",
    "        page: { type: integer, minimum: 1 }",
    "        limit: { type: integer, minimum: 1, maximum: 48 }",
    "        total: { type: integer, minimum: 0 }",
    "        unfilteredTotal: { type: integer, minimum: 0 }",
    "        pageCount: { type: integer, minimum: 1 }",
    "        hasPreviousPage: { type: boolean }",
    "        hasNextPage: { type: boolean }",
    "        capped: { type: boolean, description: 'true ise katalog güvenlik penceresi 250 üründe sınırlandı.' }",
    "    ProductConnectionResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [products, facets, pagination, appliedFilters, sort, localization]",
    "          properties:",
    "            products: { type: array, items: { $ref: '#/components/schemas/Product' } }",
    "            facets: { $ref: '#/components/schemas/CatalogFacets' }",
    "            pagination: { $ref: '#/components/schemas/Pagination' }",
    "            appliedFilters: { type: object, additionalProperties: true }",
    "            sort: { type: string }",
    "            localization: { $ref: '#/components/schemas/Localization' }",
    "    ProductResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [product, localization]",
    "          properties:",
    "            product: { $ref: '#/components/schemas/Product' }",
    "            localization: { $ref: '#/components/schemas/Localization' }",
    "    CollectionListResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [collections]",
    "          properties:",
    "            collections: { type: array, items: { $ref: '#/components/schemas/Collection' } }",
    "    CollectionResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/ProductConnectionResponse'",
    "        - type: object",
    "          required: [collection]",
    "          properties:",
    "            collection: { $ref: '#/components/schemas/Collection' }",
    "            filterSettings: { type: [object, 'null'], additionalProperties: true }",
    "    MenuItem:",
    "      type: object",
    "      required: [id, title, itemType, url, openInNewTab, children]",
    "      properties:",
    "        id: { type: string }",
    "        title: { type: string }",
    "        itemType: { type: string }",
    "        url: { type: string, format: uri-reference }",
    "        openInNewTab: { type: boolean }",
    "        children: { type: array, items: { $ref: '#/components/schemas/MenuItem' } }",
    "    Menu:",
    "      type: object",
    "      required: [id, title, handle, location, items]",
    "      properties:",
    "        id: { type: string }",
    "        title: { type: string }",
    "        handle: { type: string }",
    "        location: { type: string, enum: [main, footer, customer_accounts, custom] }",
    "        items: { type: array, items: { $ref: '#/components/schemas/MenuItem' } }",
    "    MenuListResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [menus]",
    "          properties:",
    "            menus: { type: array, items: { $ref: '#/components/schemas/Menu' } }",
    "    Promotion:",
    "      type: object",
    "      required: [id, title, kind, valueType, appliesToType, productIds, collectionIds, startsAt]",
    "      properties:",
    "        id: { type: string }",
    "        title: { type: string }",
    "        kind: { type: string, enum: [amountOffProducts, amountOffOrder, buyXGetY, freeShipping] }",
    "        valueType: { type: string, enum: [percentage, fixed, free] }",
    "        valueAmount: { type: [number, 'null'] }",
    "        maximumDiscountAmount: { type: [number, 'null'] }",
    "        appliesToType: { type: string, enum: [all, products, collections] }",
    "        productIds: { type: array, items: { type: string } }",
    "        collectionIds: { type: array, items: { type: string } }",
    "        minimumRequirementType: { type: string, enum: [none, subtotal, quantity] }",
    "        minimumSubtotal: { type: [number, 'null'] }",
    "        minimumQuantity: { type: [integer, 'null'] }",
    "        startsAt: { type: string, format: date-time }",
    "        endsAt: { type: [string, 'null'], format: date-time }",
    "        config: { type: object, additionalProperties: true }",
    "      description: Yalnız herkese açık otomatik kampanyalar döner; indirim kodu alanı bulunmaz.",
    "    PromotionListResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [promotions, localization]",
    "          properties:",
    "            promotions: { type: array, items: { $ref: '#/components/schemas/Promotion' } }",
    "            localization: { $ref: '#/components/schemas/Localization' }",
    "    LocalizationResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [localization]",
    "          properties:",
    "            localization: { $ref: '#/components/schemas/Localization' }",
    "    ShopResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [shop, settings, localization, promotions]",
    "          properties:",
    "            shop: { type: object, additionalProperties: true }",
    "            settings: { type: object, additionalProperties: true }",
    "            activeTheme: { type: [object, 'null'], additionalProperties: true }",
    "            headerLayout: { type: [object, 'null'], additionalProperties: true }",
    "            footerLayout: { type: [object, 'null'], additionalProperties: true }",
    "            localization: { $ref: '#/components/schemas/Localization' }",
    "            promotions: { type: array, items: { $ref: '#/components/schemas/Promotion' } }",
    "    StorefrontPageResponse:",
    "      type: object",
    "      required: [store, settings, products, collections, menus, localization, promotions, storefrontRevision]",
    "      properties:",
    "        store: { type: object, additionalProperties: true }",
    "        settings: { type: object, additionalProperties: true }",
    "        activeTheme: { type: [object, 'null'], additionalProperties: true }",
    "        themeLayout: { type: [object, 'null'], additionalProperties: true }",
    "        headerLayout: { type: [object, 'null'], additionalProperties: true }",
    "        footerLayout: { type: [object, 'null'], additionalProperties: true }",
    "        products: { type: array, items: { $ref: '#/components/schemas/Product' } }",
    "        collections: { type: array, items: { $ref: '#/components/schemas/Collection' } }",
    "        menus: { type: array, items: { $ref: '#/components/schemas/Menu' } }",
    "        selectedProduct: { oneOf: [{ $ref: '#/components/schemas/Product' }, { type: 'null' }] }",
    "        selectedCollection: { oneOf: [{ $ref: '#/components/schemas/Collection' }, { type: 'null' }] }",
    "        localization: { $ref: '#/components/schemas/Localization' }",
    "        promotions: { type: array, items: { $ref: '#/components/schemas/Promotion' } }",
    "        storefrontRevision: { type: string }",
    "      additionalProperties: true",
    "    ContentPageResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [page]",
    "          properties:",
    "            page: { type: object, additionalProperties: true }",
    "    BlogListResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [blogs]",
    "          properties:",
    "            blogs: { type: array, items: { type: object, additionalProperties: true } }",
    "    BlogResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [blog, posts]",
    "          properties:",
    "            blog: { type: object, additionalProperties: true }",
    "            posts: { type: array, items: { type: object, additionalProperties: true } }",
    "    BlogPostResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [blog, post, products]",
    "          properties:",
    "            blog: { type: object, additionalProperties: true }",
    "            post: { type: object, additionalProperties: true }",
    "            products: { type: array, items: { $ref: '#/components/schemas/Product' } }",
    "    SearchResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/StorefrontMeta'",
    "        - type: object",
    "          required: [search, products, collections]",
    "          properties:",
    "            search: { type: [object, 'null'], additionalProperties: true }",
    "            products: { type: array, items: { $ref: '#/components/schemas/Product' } }",
    "            collections: { type: array, items: { $ref: '#/components/schemas/Collection' } }",
    "    StorefrontError:",
    "      type: object",
    "      required: [error]",
    "      properties:",
    "        error: { type: string }",
    "  responses:",
  );
  for (const [name, status] of [["BadRequest", 400], ["Unauthorized", 401], ["Forbidden", 403], ["NotFound", 404], ["RateLimited", 429], ["InternalError", 500]]) {
    lines.push(`    ${name}:`, `      description: HTTP ${status}`, "      content:", "        application/json:", "          schema:", "            $ref: '#/components/schemas/StorefrontError'");
  }
  return `${lines.join("\n")}\n`;
};

const renderHtml = (catalog) => {
  const nav = catalog.resources.map((resource) => `<a href="#${slug(resource.key)}">${escapeHtml(resource.name)} <span>${resource.operations.length}</span></a>`).join("");
  const sections = catalog.resources.map((resource) => {
    const operations = resource.operations.map((item) => {
      const parameters = [
        ...Array.from(item.path.matchAll(/\{([^}]+)\}/g), (match) => match[1]),
        ...queryParameters(item),
      ];
      return `
        <article class="operation">
          <div class="operation-line"><span class="method ${item.method.toLowerCase()}">${item.method}</span><code>${escapeHtml(catalog.basePath + item.path)}</code><span class="auth">${escapeHtml(item.auth)}</span></div>
          <h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.description)}</p>
          <div class="contract-row"><strong>Parametreler</strong><div class="parameter-list">${parameters.length ? parameters.map((name) => `<code>${escapeHtml(name)}</code>`).join("") : "<span>Yok</span>"}</div></div>
          <div class="contract-row"><strong>Yanıt</strong><code>${escapeHtml(responseSchemaFor(item))}</code></div>
          <div class="meta"><span>Cache: ${escapeHtml(item.cache)}</span>${item.scope ? `<span>Scope: ${escapeHtml(item.scope)}</span>` : ""}</div>
        </article>`;
    }).join("");
    return `
    <section id="${slug(resource.key)}" class="resource">
      <div class="resource-head"><div><p class="eyebrow">RESOURCE</p><h2>${escapeHtml(resource.name)}</h2><p>${escapeHtml(resource.description)}</p></div><strong>${resource.operations.length} endpoint</strong></div>
      <div class="operations">${operations}</div>
    </section>`;
  }).join("");
  const coverage = `
    <section id="theme-coverage" class="coverage">
      <div class="resource-head"><div><p class="eyebrow">TEMA GELİŞTİRME KAPSAMI</p><h2>Harici bir temanın ihtiyaç duyduğu veri yüzeyi</h2><p>ThemeForest veya özel bir frontend, yönetim veritabanına bağlanmadan aşağıdaki sözleşmelerle çalışır.</p></div><strong>6 alan</strong></div>
      <div class="coverage-grid">
        <article><b>Navigasyon</b><p>Header, mega menu, mobil menü ve footer için konumlu, çok seviyeli <code>/menus</code> ağacı.</p></article>
        <article><b>Kategori ve filtre</b><p>Koleksiyon, marka, ürün tipi, kategori, etiket, renk, beden, stok ve fiyat facetleri; sayfalama ve sıralama.</p></article>
        <article><b>Ürün ve fiyat</b><p>Varyant seçenekleri, görseller, stok, satış fiyatı, karşılaştırma fiyatı ve mağaza para birimi. Maliyet değeri maskelenir.</p></article>
        <article><b>Kampanya</b><p>Aktif otomatik promosyonlar ve hedef ürün/koleksiyonlar. Özel müşteri kuralları ile indirim kodları hiçbir zaman açılmaz.</p></article>
        <article><b>İçerik ve SEO</b><p>Sayfalar, bloglar, blog yazıları, SEO alanları, tema layout'u ve header/footer shell verisi.</p></article>
        <article><b>Müşteri ve ticaret</b><p>Aynı-origin güvenli oturumla giriş, kayıt, parola, wishlist, yorum, stok bildirimi ve checkout devri.</p></article>
      </div>
    </section>`;
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopiyz Storefront API</title><meta name="description" content="Shopiyz Storefront API v1 dokümantasyonu"><link rel="icon" href="./favicon.svg"><style>
:root{--ink:#111;--muted:#646464;--line:#e5e5e5;--soft:#f7f7f7;--blue:#075985;--green:#166534}*{box-sizing:border-box}html{max-width:100%;scroll-behavior:smooth;overflow-x:hidden}body{max-width:100%;margin:0;color:var(--ink);font:15px/1.6 Inter,ui-sans-serif,system-ui;background:#fff;overflow-x:hidden}a{color:inherit}.topbar{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:270px minmax(0,1fr) auto;align-items:center;min-height:72px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.brand{display:flex;align-items:center;gap:10px;padding:0 26px;font-weight:800;text-decoration:none}.brand img{width:34px;height:34px}.tabs{display:flex;justify-content:center;gap:8px;min-width:0}.tabs a{padding:9px 13px;border-radius:8px;text-decoration:none;font-weight:700}.tabs .active{background:#111;color:#fff}.topbar>.openapi{margin-right:24px;padding:9px 13px;border:1px solid var(--line);border-radius:8px;text-decoration:none;font-weight:700}.layout{display:grid;grid-template-columns:270px minmax(0,1fr);width:100%;max-width:100%}aside{position:sticky;top:72px;height:calc(100vh - 72px);padding:24px 18px;border-right:1px solid var(--line);overflow:auto}aside p{margin:0 10px 12px;color:#8a8a8a;font-size:12px;font-weight:800;letter-spacing:.12em}aside a{display:flex;justify-content:space-between;padding:9px 10px;border-radius:7px;text-decoration:none}aside a:hover{background:var(--soft)}aside span{color:#999}main{min-width:0;max-width:100%}.container{width:100%;max-width:1120px;min-width:0;margin:auto;padding:52px 42px 100px}.hero{padding:42px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(135deg,#f4f4f4,#fff 55%)}.eyebrow{margin:0 0 8px;color:#666;font-size:12px;font-weight:850;letter-spacing:.14em}.hero h1{max-width:780px;margin:0 0 16px;font-size:48px;line-height:1.05}.hero>p{max-width:760px;color:var(--muted);font-size:18px}.badges,.meta{display:flex;flex-wrap:wrap;gap:8px}.badges span,.meta span,.auth{padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px}.architecture{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:28px}.architecture div{padding:16px;border:1px solid var(--line);border-radius:9px;background:#fff;font-weight:750;text-align:center}.architecture b{display:block;color:#777;font-size:11px}.guide{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin:24px 0 54px}.card{min-width:0;overflow:hidden;padding:24px;border:1px solid var(--line);border-radius:10px}.card h2{margin:0 0 8px}.card pre{width:100%;max-width:100%;overflow-x:auto;padding:16px;border-radius:8px;background:#111;color:#f5f5f5;font:13px/1.5 ui-monospace,SFMono-Regular,monospace;white-space:pre}.coverage{scroll-margin-top:90px;margin:54px 0}.coverage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}.coverage-grid article{min-width:0;padding:20px;border:1px solid var(--line);border-radius:9px;background:var(--soft)}.coverage-grid article b{font-size:16px}.coverage-grid article p{margin:6px 0 0;color:var(--muted)}.resource{scroll-margin-top:90px;margin-top:54px}.resource-head{display:flex;justify-content:space-between;gap:20px;align-items:start;padding-bottom:18px;border-bottom:1px solid var(--line)}.resource-head h2{margin:0}.resource-head p:last-child{max-width:760px;margin:6px 0 0;color:var(--muted)}.resource-head>strong{white-space:nowrap}.operations{display:grid;gap:12px;margin-top:18px}.operation{min-width:0;overflow:hidden;padding:20px;border:1px solid var(--line);border-radius:9px}.operation-line{display:flex;align-items:center;gap:10px;min-width:0}.operation-line code{min-width:0;overflow-wrap:anywhere;font:13px ui-monospace,SFMono-Regular,monospace}.method{min-width:48px;padding:4px 7px;border-radius:5px;color:#fff;font-size:11px;font-weight:900;text-align:center}.method.get{background:var(--blue)}.method.post{background:var(--green)}.operation h3{margin:15px 0 5px}.operation p{margin:0 0 12px;color:var(--muted)}.contract-row{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px;align-items:start;margin:10px 0}.contract-row>code{overflow-wrap:anywhere}.parameter-list{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.parameter-list code{padding:2px 7px;border-radius:5px;background:var(--soft);overflow-wrap:anywhere}@media(max-width:820px){.topbar{grid-template-columns:minmax(0,1fr) auto}.brand{padding:0 14px}.tabs{grid-column:1/-1;grid-row:2;padding:8px;border-top:1px solid var(--line)}.layout{display:block}aside{display:none}.container{padding:28px 18px 70px}.hero{padding:26px}.hero h1{font-size:36px}.architecture,.coverage-grid{grid-template-columns:1fr}.guide{grid-template-columns:1fr}.topbar>.openapi{margin-right:14px}.resource-head{display:block}.resource-head>strong{display:inline-block;margin-top:10px}.operation-line{align-items:flex-start;flex-wrap:wrap}.contract-row{grid-template-columns:1fr}}
</style></head><body><header class="topbar"><a class="brand" href="/"><img src="/favicon.svg" alt=""><span>Shopiyz <strong>Docs</strong></span></a><nav class="tabs" aria-label="API seçimi"><a href="/">Admin API</a><a class="active" href="/storefront">Storefront API</a></nav><a class="openapi" href="/openapi/shopiyz-storefront-api.yaml">OpenAPI</a></header><div class="layout"><aside><p>STOREFRONT API</p><a href="#overview">Overview</a><a href="#quickstart">Quickstart</a><a href="#theme-coverage">Tema kapsamı</a>${nav}</aside><main><div class="container"><section id="overview" class="hero"><p class="eyebrow">STOREFRONT API v1</p><h1>Temalar için tek, hızlı ve güvenli veri sözleşmesi.</h1><p>Shopiyz temaları D1'e bağlanmaz. Aynı-origin Storefront Runtime veya mağazaya bağlı headless token bu API'yi çağırır; fiyat, varyant, menü, filtre, içerik ve kampanya verisi tek sürümlü sözleşmeden gelir.</p><div class="badges"><span>${catalog.summary.resources} kaynak</span><span>${catalog.summary.operations} endpoint</span><span>storefront:read</span><span>Edge cache</span><span>Typed OpenAPI</span></div><div class="architecture"><div><b>1</b>D1 / R2</div><div><b>2</b>Storefront API v1</div><div><b>3</b>Ortak Runtime</div><div><b>4</b>Tema 1…300</div></div></section><section id="quickstart" class="guide"><article class="card"><h2>Aynı origin tema</h2><p>Shopiyz temaları public GET uçlarını token taşımadan çağırır. Müşteri ve checkout işlemleri güvenli oturum çereziyle aynı origin'de kalır.</p><pre>const page = await fetch(
  "/api/storefront/v1/page?pageType=home&path=/"
).then(r =&gt; r.json());</pre></article><article class="card"><h2>Headless istemci</h2><p>Harici istemci mağazaya bağlı Storefront tokenı kullanır. Token yalnızca <code>storefront:read</code> kapsamına sahiptir.</p><pre>curl -H \
  "X-Shopiyz-Storefront-Access-Token: shpft_…" \
  "https://store.myshopiyz.com/api/storefront/v1/products"</pre></article><article class="card"><h2>Koleksiyon filtreleri</h2><p>Facet değerleri ve ürünler aynı yanıtta gelir; tema yalnız URL query'sini yönetir.</p><pre>const listing = await fetch(
  "/api/storefront/v1/collections/all" +
  "?color=Siyah&size=M&sort=price-asc&page=1"
).then(r =&gt; r.json());

renderFilters(listing.facets);
renderProducts(listing.products);</pre></article><article class="card"><h2>Fiyat ve kampanya</h2><p>Fiyatlar <code>localization.currency</code> ile formatlanır. Yalnız herkese açık otomatik promosyonlar okunur.</p><pre>const [pricing, campaign] = await Promise.all([
  fetch("/api/storefront/v1/localization").then(r =&gt; r.json()),
  fetch("/api/storefront/v1/promotions").then(r =&gt; r.json())
]);</pre></article></section>${coverage}${sections}</div></main></div></body></html>`;
};

const writeOutputs = (catalog) => {
  const html = renderHtml(catalog);
  const yaml = renderOpenApi(catalog);
  for (const [relative, content] of [
    ["storefront.html", html],
    ["public/storefront.html", html],
    ["openapi/shopiyz-storefront-api.yaml", yaml],
    ["openapi/shopiyz-storefront-api.v1.yaml", yaml],
    ["public/openapi/shopiyz-storefront-api.yaml", yaml],
    ["public/openapi/shopiyz-storefront-api.v1.yaml", yaml],
  ]) {
    const target = path.join(docsRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
};

const catalog = await loadCatalog();
writeOutputs(catalog);
console.log(JSON.stringify({ version: catalog.version, resources: catalog.summary.resources, operations: catalog.summary.operations }, null, 2));
