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
  if (operation.auth === "customer_oauth") return ["      security:", "        - CustomerOAuthBearer: []"];
  if (operation.auth === "storefront_token") return ["      security:", "        - StorefrontAccessToken: []", "        - StorefrontBearerAuth: []"];
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
  if (operation.path === "/customer/oauth/authorize") names.push("storeId", "response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method");
  if (["/customer/oauth/token", "/customer/oauth/revoke", "/newsletter-subscriptions", "/checkout-sessions"].includes(operation.path)) names.push("storeId");
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
  response_type: { type: "string", enum: ["code"], description: "OAuth Authorization Code akışı." },
  client_id: { type: "string", description: "Admin panelindeki Storefront token kaydının client ID değeri." },
  redirect_uri: { type: "string", description: "İstemciye kayıtlı adresle tam eşleşen HTTPS callback URI." },
  scope: { type: "string", description: "Boşlukla ayrılmış customer:read ve customer:write kapsamları." },
  state: { type: "string", description: "CSRF koruması için en az 16 karakterlik tek kullanımlık istemci state değeri." },
  nonce: { type: "string", description: "Replay koruması için en az 16 karakterlik tek kullanımlık nonce." },
  code_challenge: { type: "string", description: "PKCE S256 code challenge." },
  code_challenge_method: { type: "string", enum: ["S256"], description: "Yalnız S256 desteklenir." },
};

const requiredAuthorizeParameters = new Set([
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "nonce",
  "code_challenge",
  "code_challenge_method",
]);

const queryParameterRequired = (operation, name) =>
  operation.path === "/customer/oauth/authorize" && requiredAuthorizeParameters.has(name);

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
  if (operation.path === "/checkout-sessions") return "CheckoutSessionResponse";
  if (operation.path === "/checkout-sessions/{token}") return "CheckoutSessionConsumeResponse";
  if (operation.path === "/customer/oauth/token") return "OAuthTokenResponse";
  if (operation.path === "/customer/oauth/revoke") return "OAuthRevokeResponse";
  if (operation.path === "/customer/me") return "CustomerProfileResponse";
  if (operation.path === "/newsletter-subscriptions") return "NewsletterAcceptedResponse";
  return "StorefrontResponse";
};

const requestSchemaFor = (operation) => {
  if (operation.path === "/checkout-sessions") return "CheckoutSessionRequest";
  if (operation.path === "/customer/oauth/token") return "OAuthTokenRequest";
  if (operation.path === "/customer/oauth/revoke") return "OAuthRevokeRequest";
  if (operation.path === "/customer/me" && operation.method === "PATCH") return "CustomerProfilePatch";
  if (operation.path === "/newsletter-subscriptions") return "NewsletterSubscriptionRequest";
  return null;
};

const successStatusFor = (operation) => operation.path === "/checkout-sessions" ? "201" : operation.path === "/newsletter-subscriptions" ? "202" : "200";

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
            `          required: ${queryParameterRequired(operation, name)}`,
            `          description: ${yamlString(detail.description)}`,
            `          schema: { ${schemaParts.join(", ")} }`,
          );
        }
      }
      if (operation.path === "/checkout-sessions") {
        lines.push("        - name: Idempotency-Key", "          in: header", "          required: true", "          schema: { type: string, minLength: 8, maxLength: 200 }");
      }
      if (operation.method === "POST" || operation.method === "PATCH") {
        const schema = requestSchemaFor(operation);
        lines.push("      requestBody:", "        required: true", "        content:", "          application/json:", "            schema:");
        if (schema) lines.push(`              $ref: '#/components/schemas/${schema}'`);
        else lines.push("              type: object", "              additionalProperties: true");
        if (operation.path === "/customer/oauth/token" || operation.path === "/customer/oauth/revoke") {
          lines.push("          application/x-www-form-urlencoded:", "            schema:", `              $ref: '#/components/schemas/${schema}'`);
        }
      }
      lines.push("      responses:", `        '${successStatusFor(operation)}':`, "          description: Successful Storefront response", "          content:", "            application/json:", "              schema:", `                $ref: '#/components/schemas/${responseSchemaFor(operation)}'`, "        '400':", "          $ref: '#/components/responses/BadRequest'", "        '401':", "          $ref: '#/components/responses/Unauthorized'", "        '403':", "          $ref: '#/components/responses/Forbidden'", "        '404':", "          $ref: '#/components/responses/NotFound'", "        '409':", "          $ref: '#/components/responses/Conflict'", "        '422':", "          $ref: '#/components/responses/UnprocessableEntity'", "        '429':", "          $ref: '#/components/responses/RateLimited'", "        '500':", "          $ref: '#/components/responses/InternalError'");
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
    "    CustomerOAuthBearer:",
    "      type: http",
    "      scheme: bearer",
    "      bearerFormat: shpcat",
    "  schemas:",
    "    StorefrontResponse:",
    "      type: object",
    "      additionalProperties: true",
    "    ErrorResponse:",
    "      type: object",
    "      required: [error]",
    "      properties:",
    "        error:",
    "          type: object",
    "          required: [code, message]",
    "          properties:",
    "            code: { type: string }",
    "            message: { type: string }",
    "            details: {}",
    "    CheckoutLineInput:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [variantId, quantity]",
    "      properties:",
    "        variantId: { type: string, minLength: 1 }",
    "        quantity: { type: integer, minimum: 1, maximum: 99 }",
    "    CheckoutSessionRequest:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [lines, returnUrl, cancelUrl]",
    "      properties:",
    "        lines: { type: array, minItems: 1, maxItems: 50, items: { $ref: '#/components/schemas/CheckoutLineInput' } }",
    "        locale: { type: string }",
    "        currency: { type: string, pattern: '^[A-Z]{3}$' }",
    "        returnUrl: { type: string, format: uri }",
    "        cancelUrl: { type: string, format: uri }",
    "    CheckoutSessionResponse:",
    "      type: object",
    "      required: [id, checkoutId, status, checkoutUrl, expiresAt, currency, lines, subtotal, discountTotal, shippingTotal, taxTotal, total, pricing]",
    "      properties:",
    "        id: { type: string }",
    "        checkoutId: { type: string }",
    "        status: { type: string, enum: [pending] }",
    "        checkoutUrl: { type: string, format: uri }",
    "        expiresAt: { type: string, format: date-time }",
    "        locale: { type: string }",
    "        currency: { type: string }",
    "        lines: { type: array, items: { type: object, additionalProperties: true } }",
    "        subtotal: { type: integer, minimum: 0, description: Minor currency units }",
    "        discountTotal: { type: integer, minimum: 0, description: Minor currency units }",
    "        shippingTotal: { type: [integer, 'null'], minimum: 0, description: Address is not known at session creation }",
    "        taxTotal: { type: integer, minimum: 0, description: Minor currency units }",
    "        total: { type: integer, minimum: 0, description: Minor currency units }",
    "        pricing: { type: object, additionalProperties: true }",
    "    CheckoutSessionConsumeResponse:",
    "      allOf:",
    "        - $ref: '#/components/schemas/CheckoutSessionResponse'",
    "        - type: object",
    "          properties:",
    "            status: { type: string, enum: [consumed] }",
    "            returnUrl: { type: string, format: uri }",
    "            cancelUrl: { type: string, format: uri }",
    "    OAuthTokenRequest:",
    "      type: object",
    "      required: [grant_type, client_id]",
    "      properties:",
    "        grant_type: { type: string, enum: [authorization_code, refresh_token] }",
    "        client_id: { type: string }",
    "        code: { type: string }",
    "        code_verifier: { type: string, minLength: 43, maxLength: 128 }",
    "        redirect_uri: { type: string, format: uri }",
    "        refresh_token: { type: string }",
    "    OAuthTokenResponse:",
    "      type: object",
    "      required: [token_type, access_token, expires_in, refresh_token, scope]",
    "      properties:",
    "        token_type: { type: string, enum: [Bearer] }",
    "        access_token: { type: string }",
    "        expires_in: { type: integer }",
    "        refresh_token: { type: string }",
    "        refresh_token_expires_in: { type: integer }",
    "        scope: { type: string }",
    "        nonce: { type: string }",
    "    OAuthRevokeRequest:",
    "      type: object",
    "      required: [client_id, token]",
    "      properties:",
    "        client_id: { type: string }",
    "        token: { type: string }",
    "    OAuthRevokeResponse:",
    "      type: object",
    "      required: [revoked]",
    "      properties: { revoked: { type: boolean } }",
    "    CustomerProfilePatch:",
    "      type: object",
    "      additionalProperties: false",
    "      properties:",
    "        firstName: { type: [string, 'null'] }",
    "        lastName: { type: [string, 'null'] }",
    "        phone: { type: [string, 'null'] }",
    "        locale: { type: string }",
    "        acceptsMarketingEmail: { type: boolean }",
    "    CustomerProfileResponse:",
    "      type: object",
    "      required: [customer]",
    "      properties:",
    "        customer:",
    "          type: object",
    "          additionalProperties: false",
    "          required: [id, email, acceptsMarketingEmail, emailVerified]",
    "          properties:",
    "            id: { type: string }",
    "            firstName: { type: [string, 'null'] }",
    "            lastName: { type: [string, 'null'] }",
    "            email: { type: string, format: email }",
    "            phone: { type: [string, 'null'] }",
    "            locale: { type: [string, 'null'] }",
    "            acceptsMarketingEmail: { type: boolean }",
    "            emailVerified: { type: boolean }",
    "    NewsletterSubscriptionRequest:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [email, consent]",
    "      properties:",
    "        email: { type: string, format: email }",
    "        locale: { type: string }",
    "        source: { type: string, maxLength: 120 }",
    "        consent: { type: boolean, const: true }",
    "        website: { type: string, description: Honeypot; gerçek kullanıcılar boş bırakır. }",
    "        turnstileToken: { type: string }",
    "    NewsletterAcceptedResponse:",
    "      type: object",
    "      required: [accepted, message]",
    "      properties:",
    "        accepted: { type: boolean, const: true }",
    "        message: { type: string }",
    "    StorefrontMeta:",
    "      type: object",
    "      properties:",
    "        apiVersion: { type: string }",
    "        storefrontRevision: { type: [string, 'null'] }",
    "    Localization:",
    "      type: object",
    "      required: [currency, locale, defaultLocale, supportedLocales, currencySymbol, timezone, country, minimumFractionDigits, maximumFractionDigits, markets, availableCountries]",
    "      properties:",
    "        currency: { type: string, pattern: '^[A-Z]{3}$', description: Mağazanın varsayılan para birimi. }",
    "        locale: { type: string, description: Bu yanıt için kullanılan BCP 47 varsayılan locale. }",
    "        defaultLocale: { type: string, description: Mağazada varsayılan ve yayınlanmış BCP 47 locale. }",
    "        supportedLocales: { type: array, items: { type: string }, minItems: 1, uniqueItems: true, description: Yalnız yayınlanmış mağaza dilleri; yayın dışı diller eklenmez. }",
    "        currencySymbol: { type: string }",
    "        minimumFractionDigits: { type: integer, minimum: 0 }",
    "        maximumFractionDigits: { type: integer, minimum: 0 }",
    "        timezone: { type: string }",
    "        country: { type: [string, 'null'], pattern: '^[A-Z]{2}$' }",
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
    "    ShopIdentity:",
    "      type: object",
    "      additionalProperties: true",
    "      required: [id, name, displayName, description, status, country, timezone, platformDomain]",
    "      properties:",
    "        id: { type: string }",
    "        name: { type: string }",
    "        displayName: { type: string }",
    "        description: { type: [string, 'null'] }",
    "        status: { type: string }",
    "        country: { type: [string, 'null'], pattern: '^[A-Z]{2}$' }",
    "        timezone: { type: string }",
    "        platformDomain: { type: [string, 'null'], description: Doğrulanmış Shopiyz platform hostname'i; canonical özel domainden farklıdır. }",
    "    StorefrontIdentity:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [canonicalOrigin, primaryHostname, alternateHostnames, domainStatus, defaultLocale, supportedLocales, defaultCurrency]",
    "      properties:",
    "        canonicalOrigin: { type: [string, 'null'], format: uri, description: Yalnız doğrulanmış, SSL'i aktif ve bağlı domain kaydından üretilir; istek Host veya Origin başlığından türetilmez. }",
    "        primaryHostname: { type: [string, 'null'] }",
    "        alternateHostnames: { type: array, items: { type: string }, uniqueItems: true }",
    "        domainStatus: { type: string, enum: [connected, pending, unconfigured] }",
    "        defaultLocale: { type: string }",
    "        supportedLocales: { type: array, items: { type: string }, minItems: 1, uniqueItems: true }",
    "        defaultCurrency: { type: string, pattern: '^[A-Z]{3}$' }",
    "    StorefrontBranding:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [logoUrl, logoLightUrl, logoDarkUrl, logoMobileUrl, logoAlt, logoWidth, logoHeight, faviconUrl, defaultOgImageUrl, defaultOgImageWidth, defaultOgImageHeight, defaultOgImageAlt]",
    "      properties:",
    "        logoUrl: { type: [string, 'null'], format: uri-reference }",
    "        logoLightUrl: { type: [string, 'null'], format: uri-reference }",
    "        logoDarkUrl: { type: [string, 'null'], format: uri-reference }",
    "        logoMobileUrl: { type: [string, 'null'], format: uri-reference }",
    "        logoAlt: { type: string, description: Görsel bulunmadığında displayName tabanlı güvenli metin fallback'i. }",
    "        logoWidth: { type: [integer, 'null'], minimum: 1 }",
    "        logoHeight: { type: [integer, 'null'], minimum: 1 }",
    "        faviconUrl: { type: [string, 'null'], format: uri-reference }",
    "        defaultOgImageUrl: { type: [string, 'null'], format: uri-reference }",
    "        defaultOgImageWidth: { type: [integer, 'null'], minimum: 1 }",
    "        defaultOgImageHeight: { type: [integer, 'null'], minimum: 1 }",
    "        defaultOgImageAlt: { type: string }",
    "      description: Yapılandırılmamış varlıklar null döner; başka tenant veya demo markası fallback olarak kullanılmaz.",
    "    StorefrontSeo:",
    "      type: object",
    "      additionalProperties: false",
    "      required: [siteName, homeTitle, metaDescription]",
    "      properties:",
    "        siteName: { type: string }",
    "        homeTitle: { type: string }",
    "        metaDescription: { type: string }",
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
    "          required: [shop, storefront, branding, seo, settings, localization, promotions]",
    "          properties:",
    "            shop: { $ref: '#/components/schemas/ShopIdentity' }",
    "            storefront: { $ref: '#/components/schemas/StorefrontIdentity' }",
    "            branding: { $ref: '#/components/schemas/StorefrontBranding' }",
    "            seo: { $ref: '#/components/schemas/StorefrontSeo' }",
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
  for (const [name, status] of [["BadRequest", 400], ["Unauthorized", 401], ["Forbidden", 403], ["NotFound", 404], ["Conflict", 409], ["UnprocessableEntity", 422], ["RateLimited", 429], ["InternalError", 500]]) {
    lines.push(`    ${name}:`, `      description: HTTP ${status}`, "      content:", "        application/json:", "          schema:", "            oneOf:", "              - $ref: '#/components/schemas/StorefrontError'", "              - $ref: '#/components/schemas/ErrorResponse'");
  }
  return `${lines.join("\n")}\n`;
};

const renderHtml = (catalog) => {
  const nav = catalog.resources.map((resource) => `<a href="#${slug(resource.key)}" data-sidebar-link><span>${escapeHtml(resource.name)}</span><span class="nav-count">${resource.operations.length}</span></a>`).join("");
  const mobileNav = catalog.resources.map((resource) => `<a href="#${slug(resource.key)}">${escapeHtml(resource.name)} <span>${resource.operations.length}</span></a>`).join("");
  let sections = catalog.resources.map((resource) => {
    const operations = resource.operations.map((item) => {
      const parameters = [
        ...Array.from(item.path.matchAll(/\{([^}]+)\}/g), (match) => match[1]),
        ...queryParameters(item),
      ];
      return `
        <article class="operation" data-operation-card data-search-text="${escapeHtml(`${item.method} ${catalog.basePath + item.path} ${item.summary} ${item.description}`.toLowerCase())}">
          <div class="operation-line"><span class="method ${item.method.toLowerCase()}"${item.method === "PATCH" ? ' style="background:#9a3412"' : ""}>${item.method}</span><code>${escapeHtml(catalog.basePath + item.path)}</code><span class="auth">${escapeHtml(item.auth)}</span></div>
          <h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.description)}</p>
          <div class="contract-row"><strong>Parametreler</strong><div class="parameter-list">${parameters.length ? parameters.map((name) => `<code>${escapeHtml(name)}</code>`).join("") : "<span>Yok</span>"}</div></div>
          <div class="contract-row"><strong>Yanıt</strong><code>${escapeHtml(responseSchemaFor(item))}</code></div>
          <div class="meta"><span>Cache: ${escapeHtml(item.cache)}</span>${item.scope ? `<span>Scope: ${escapeHtml(item.scope)}</span>` : ""}</div>
        </article>`;
    }).join("");
    return `
    <section id="${slug(resource.key)}" class="resource-group" data-resource-group>
      <button class="resource-head" type="button" aria-expanded="false" data-resource-toggle>
        <span><span class="eyebrow">RESOURCE</span><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.description)}</small></span>
        <span class="resource-meta"><b>${resource.operations.length} endpoint</b><i aria-hidden="true">+</i></span>
      </button>
      <div class="operations" hidden>${operations}</div>
    </section>`;
  }).join("");
  const coverage = `
    <section id="theme-coverage" class="docs-section coverage">
      <div class="section-copy"><p class="eyebrow">TEMA GELİŞTİRME KAPSAMI</p><h2>Harici bir temanın ihtiyaç duyduğu veri yüzeyi</h2><p>ThemeForest veya özel bir frontend, yönetim veritabanına bağlanmadan aşağıdaki sözleşmelerle çalışır.</p></div>
      <div class="coverage-grid">
        <article><b>Navigasyon</b><p>Header, mega menu, mobil menü ve footer için konumlu, çok seviyeli <code>/menus</code> ağacı.</p></article>
        <article><b>Kategori ve filtre</b><p>Koleksiyon, marka, ürün tipi, kategori, etiket, renk, beden, stok ve fiyat facetleri; sayfalama ve sıralama.</p></article>
        <article><b>Ürün ve fiyat</b><p>Varyant seçenekleri, görseller, stok, satış fiyatı, karşılaştırma fiyatı ve mağaza para birimi. Maliyet değeri maskelenir.</p></article>
        <article><b>Kampanya</b><p>Aktif otomatik promosyonlar ve hedef ürün/koleksiyonlar. Özel müşteri kuralları ile indirim kodları hiçbir zaman açılmaz.</p></article>
        <article><b>İçerik ve SEO</b><p>Sayfalar, bloglar, blog yazıları, SEO alanları, tema layout'u ve header/footer shell verisi.</p></article>
        <article><b>Müşteri ve ticaret</b><p>Aynı-origin güvenli oturumla giriş, kayıt, parola, wishlist, yorum, stok bildirimi ve checkout devri.</p></article>
      </div>
    </section>`;
  const headlessGuides = `
    <section id="headless-security" class="docs-section">
      <div class="section-copy"><p class="eyebrow">HEADLESS SECURITY</p><h2>Checkout, müşteri OAuth ve newsletter</h2><p>Her istemci ayrı origin, redirect URI ve en az yetki kapsamıyla kaydedilir. Eski <code>storefront:read</code> tokenleri checkout veya müşteri yetkisi kazanmaz.</p></div>
      <div class="quick-grid">
        <article class="card"><h3>Headless checkout</h3><p>Fiyat ve stok istemciden alınmaz; sunucu kanonik varyantları doğrular. Her istek benzersiz bir idempotency anahtarı taşır.</p><pre>curl -X POST \
  -H "Authorization: Bearer shpft_…" \
  -H "Idempotency-Key: cart-7f23f2c1" \
  -H "Content-Type: application/json" \
  -d '{"lines":[{"variantId":"var_123","quantity":1}],"returnUrl":"https://app.example.com/paid","cancelUrl":"https://app.example.com/cart"}' \
  https://store.myshopiyz.com/api/storefront/v1/checkout-sessions</pre></article>
        <article class="card"><h3>React PKCE özeti</h3><p>Verifier tarayıcıda tutulur; challenge S256 ile üretilir. Callback state ve dönen nonce doğrulanmadan token kullanılmaz.</p><pre>const verifier = createVerifier();
const challenge = base64url(
  await crypto.subtle.digest("SHA-256", encode(verifier))
);
sessionStorage.setItem("pkce", verifier);
location.assign(authorizeUrl({
  response_type: "code",
  code_challenge_method: "S256",
  code_challenge: challenge,
  state: randomState(), nonce: randomNonce()
}));</pre></article>
        <article class="card"><h3>Newsletter</h3><p>Yeni ve mevcut adresler aynı <code>202</code> yanıtını alır. Pazarlama izni yalnız e-posta bağlantısı doğrulandıktan sonra etkinleşir.</p><pre>await fetch("/api/storefront/v1/newsletter-subscriptions", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    email, locale: "tr-TR",
    source: "footer", consent: true
  })
});</pre></article>
        <article class="card"><h3>Tehdit modeli</h3><p>Origin sahteciliği exact allowlist, kod ele geçirme PKCE S256, replay tek kullanımlık kod/token, refresh hırsızlığı rotasyon ve reuse detection, bot trafiği Turnstile/honeypot/rate limit ile sınırlandırılır. Tokenler yalnız hash olarak saklanır.</p><pre>scope: least privilege
redirect: exact HTTPS URI
access token: 15 minutes
authorization code: 60 seconds
checkout URL: signed + single-use
CORS: explicit origin, never *</pre></article>
        <article class="card"><h3>Rollout ve geri alma</h3><p>Yeni yetkiler opt-in'dir. Önce istemciye exact origin/redirect kaydı ve yalnız gerekli scope verilir; pilot doğrulandıktan sonra trafik açılır. Sorunda istemci tokenini revoke etmek erişimi anında keser. Yeni tablolar eklemelidir; eski same-origin checkout, müşteri ve newsletter uçları değişmeden çalışır.</p><pre>rollout: allowlist → scope → pilot → monitor
rollback: revoke storefront client token
legacy routes: unchanged
database: additive migration</pre></article>
      </div>
    </section>`;
  sections = headlessGuides + sections;
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopiyz Storefront API</title><meta name="description" content="Shopiyz Storefront API v1 dokümantasyonu"><link rel="icon" href="/favicon.svg"><style>
:root{color-scheme:light;--bg:#fff;--page:#f7f7f7;--surface:#fff;--soft:#f5f5f5;--ink:#111;--ink-strong:#000;--muted:#666;--subtle:#888;--line:#e5e5e5;--line-strong:#d0d0d0;--code-bg:#111;--code:#f5f5f5;--blue:#075985;--green:#166534;--sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:"SFMono-Regular","Cascadia Code","JetBrains Mono",Consolas,monospace}*{box-sizing:border-box}html{max-width:100%;scroll-behavior:smooth;overflow-x:hidden}body{max-width:100%;margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6;overflow-x:hidden}a{color:inherit}button,input{font:inherit}code,pre{font-family:var(--mono)}.topbar{position:sticky;top:0;z-index:50;display:grid;grid-template-columns:300px minmax(0,1fr) auto;align-items:center;min-height:74px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.94);backdrop-filter:blur(16px)}.brand{display:inline-flex;align-items:center;gap:12px;height:100%;padding:0 28px;color:var(--ink-strong);font-weight:780;text-decoration:none}.brand-logo{display:grid;width:36px;height:36px;place-items:center;border:1px solid #d8d8d8;border-radius:8px;background:#f3f3f3}.brand img{display:block;width:34px;height:34px;object-fit:contain}.global-nav{display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;padding:0 18px}.global-nav a,.top-action{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;color:#333;font-size:14px;font-weight:650;line-height:1;text-decoration:none}.global-nav a:hover,.top-action:hover{background:#f2f2f2}.global-nav a.active{background:var(--ink);color:#fff}.top-actions{display:flex;align-items:center;gap:10px;padding:0 24px 0 12px}.top-search{width:min(240px,28vw);min-height:38px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:#fff;outline:none}.top-search:focus,.sidebar-filter:focus{border-color:#9b9b9b;box-shadow:0 0 0 3px rgba(0,0,0,.06)}.shell{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:calc(100vh - 74px)}.sidebar{position:sticky;top:74px;align-self:start;height:calc(100vh - 74px);overflow-y:auto;border-right:1px solid var(--line);background:#fafafa;padding:22px 22px 28px}.api-title{display:grid;gap:8px;margin-bottom:18px}.api-title strong{text-transform:uppercase}.version-row{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px}.version-pill{padding:3px 9px;border-radius:7px;background:#efefef;color:#111;font-weight:800}.sidebar-filter{width:100%;min-height:38px;margin-bottom:10px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:#fff;outline:none}.side-nav{display:grid;gap:2px}.side-nav a{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;padding:7px 10px;border-radius:8px;color:#555;font-size:13px;font-weight:650;text-decoration:none}.side-nav a:hover,.side-nav a.active{background:#f0f0f0;color:#111}.side-nav a.active{box-shadow:inset 3px 0 #111}.nav-count{color:#999;font-weight:600}.side-separator{height:1px;margin:14px 0;background:var(--line)}.sidebar-note{margin-top:22px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.sidebar-note strong{display:block;margin-bottom:4px;color:#333}.content{min-width:0;background:var(--page)}.content-inner{width:min(100%,1140px);margin:0 auto;padding:24px 28px 100px}.notice{display:flex;gap:14px;margin-bottom:20px;padding:16px 18px;border:1px solid var(--line-strong);border-radius:10px;background:var(--surface)}.notice-label{display:grid;width:26px;height:26px;flex:0 0 auto;place-items:center;border:1px solid #aaa;border-radius:999px;font-weight:800}.notice strong{display:block}.notice p{margin:2px 0 0;color:var(--muted)}.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.9fr);gap:34px;padding:34px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}.eyebrow{display:block;margin:0 0 8px;color:#666;font-size:12px;font-weight:850;letter-spacing:.14em}.hero h1{max-width:650px;margin:0 0 16px;color:#000;font-size:40px;line-height:1.1;letter-spacing:-.035em}.lead{max-width:660px;margin:0;color:#555;font-size:17px;line-height:1.65}.feature-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:24px}.feature-row strong{display:block;margin-bottom:3px;color:#111;font-size:14px}.feature-row span{display:block;color:var(--muted);font-size:13px;line-height:1.5}.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 15px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;font-size:13px;font-weight:750;text-decoration:none}.button.primary{border-color:#111;background:#111;color:#fff}.code-surface{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#111;box-shadow:0 18px 48px rgba(0,0,0,.08)}.code-bar{display:flex;align-items:center;gap:8px;padding:9px;background:#fff;border-bottom:1px solid var(--line)}.code-bar span{padding:5px 9px;border-radius:7px;background:#f2f2f2;font-size:12px;font-weight:750}.code-surface pre{min-height:285px;margin:0;padding:24px;color:var(--code);font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.overview-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:24px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}.overview-links article{padding:24px;border-right:1px solid var(--line)}.overview-links article:last-child{border-right:0}.overview-links h2{margin:0 0 7px;font-size:19px}.overview-links p{min-height:72px;margin:0 0 16px;color:var(--muted);font-size:14px}.overview-links a{font-size:13px;font-weight:750}.docs-section{scroll-margin-top:92px;margin-top:24px;padding:30px;border:1px solid var(--line);border-radius:10px;background:#fff}.section-copy{max-width:760px}.section-copy h2{margin:0;color:#000;font-size:28px;line-height:1.2;letter-spacing:-.02em}.section-copy>p:last-child{margin:8px 0 0;color:var(--muted)}.quick-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:22px}.card{min-width:0;overflow:hidden;padding:22px;border:1px solid var(--line);border-radius:9px;background:#fff}.card h3{margin:0 0 7px;font-size:18px}.card p{margin:0 0 14px;color:var(--muted)}.card pre{width:100%;max-width:100%;overflow-x:auto;margin:0;padding:16px;border-radius:8px;background:#111;color:#f5f5f5;font-size:12px;line-height:1.55;white-space:pre}.coverage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:22px}.coverage-grid article{min-width:0;padding:18px;border:1px solid var(--line);border-radius:9px;background:var(--soft)}.coverage-grid article b{font-size:15px}.coverage-grid article p{margin:5px 0 0;color:var(--muted);font-size:14px}.resource-group{scroll-margin-top:92px;margin-top:16px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}.resource-head{display:flex;width:100%;align-items:center;justify-content:space-between;gap:24px;padding:22px 24px;border:0;background:#fff;color:inherit;text-align:left;cursor:pointer}.resource-head:hover{background:#fafafa}.resource-head>span:first-child{display:grid;min-width:0}.resource-head strong{font-size:20px}.resource-head small{max-width:760px;margin-top:3px;color:var(--muted);font-size:14px;font-weight:400}.resource-meta{display:flex;align-items:center;gap:16px;white-space:nowrap}.resource-meta b{font-size:13px}.resource-meta i{display:grid;width:32px;height:32px;place-items:center;border:1px solid var(--line);border-radius:8px;font-style:normal;font-size:18px}.operations{display:grid;gap:12px;padding:0 24px 24px}.operation{min-width:0;overflow:hidden;padding:20px;border:1px solid var(--line);border-radius:9px;background:#fff}.operation-line{display:flex;align-items:center;gap:10px;min-width:0}.operation-line code{min-width:0;overflow-wrap:anywhere;font-size:13px}.method{min-width:48px;padding:4px 7px;border-radius:5px;color:#fff;font-size:11px;font-weight:900;text-align:center}.method.get{background:var(--blue)}.method.post{background:var(--green)}.auth,.meta span{padding:3px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:11px}.operation h3{margin:15px 0 5px;font-size:17px}.operation p{margin:0 0 12px;color:var(--muted);font-size:14px}.contract-row{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px;align-items:start;margin:10px 0;font-size:13px}.contract-row>code{overflow-wrap:anywhere}.parameter-list{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.parameter-list code{padding:2px 7px;border-radius:5px;background:var(--soft);overflow-wrap:anywhere}.meta{display:flex;flex-wrap:wrap;gap:7px}.empty-search{display:none;margin-top:18px;padding:18px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--muted)}.mobile-nav{display:none}.mobile-nav summary{font-weight:750;cursor:pointer}.mobile-nav div{display:grid;gap:4px;margin-top:12px}.mobile-nav a{display:flex;justify-content:space-between;padding:8px 0;text-decoration:none}.mobile-nav span{color:var(--subtle)}@media(max-width:1060px){.topbar{grid-template-columns:250px minmax(0,1fr) auto}.shell{grid-template-columns:250px minmax(0,1fr)}.sidebar{padding-inline:16px}.hero{grid-template-columns:1fr}.code-surface pre{min-height:220px}}@media(max-width:820px){.topbar{grid-template-columns:minmax(0,1fr) auto;min-height:64px}.brand{padding:0 14px}.brand-logo{width:32px;height:32px}.brand img{width:30px;height:30px}.global-nav{grid-column:1/-1;grid-row:2;justify-content:flex-start;overflow-x:auto;border-top:1px solid var(--line);padding:7px 12px}.top-actions{grid-column:2;grid-row:1;padding-right:12px}.top-search{display:none}.top-action{min-height:34px}.shell{display:block}.sidebar{display:none}.content-inner{padding:18px 14px 70px}.mobile-nav{display:block;margin-bottom:16px;padding:14px 16px;border:1px solid var(--line);border-radius:9px;background:#fff}.notice{padding:14px}.hero{padding:24px}.hero h1{font-size:32px}.lead{font-size:15px}.feature-row,.overview-links,.quick-grid,.coverage-grid{grid-template-columns:1fr}.overview-links article{border-right:0;border-bottom:1px solid var(--line)}.overview-links article:last-child{border-bottom:0}.overview-links p{min-height:0}.docs-section{padding:22px}.resource-head{align-items:flex-start;padding:18px}.resource-meta b{display:none}.operations{padding:0 16px 16px}.operation-line{align-items:flex-start;flex-wrap:wrap}.contract-row{grid-template-columns:1fr}.code-surface pre{min-height:0}.section-copy h2{font-size:24px}}@media(max-width:460px){.brand span:last-child{display:none}.global-nav a{padding-inline:10px;font-size:13px}.top-action{padding-inline:9px}.hero h1{font-size:29px}.feature-row{gap:12px}.resource-head small{font-size:13px}}
</style></head><body><header class="topbar"><a class="brand" href="/" aria-label="Shopiyz Docs"><span class="brand-logo"><img src="/favicon.svg" alt=""></span><span>Shopiyz <strong>Docs</strong></span></a><nav class="global-nav" aria-label="Ana doküman navigasyonu"><a href="/admin">Admin API</a><a class="active" href="/storefront">Storefront API</a><a href="#runtime">API reference</a><a href="/openapi">OpenAPI</a></nav><div class="top-actions"><input class="top-search" id="globalSearch" type="search" aria-label="Dokümanlarda ara" placeholder="Search"><a class="top-action" href="#quickstart">Help</a></div></header><div class="shell"><aside class="sidebar" aria-label="Storefront API navigasyonu"><div class="api-title"><strong>Storefront API</strong><div class="version-row"><span class="version-pill">REST</span><span>v1</span></div></div><input class="sidebar-filter" id="sectionFilter" type="search" aria-label="Bölüm filtrele" placeholder="Filter sections"><nav class="side-nav"><a class="active" href="#overview" data-sidebar-link><span>Overview</span></a><a href="#quickstart" data-sidebar-link><span>Quickstart</span></a><a href="#theme-coverage" data-sidebar-link><span>Tema kapsamı</span></a><div class="side-separator"></div>${nav}</nav><div class="sidebar-note"><strong>Güvenli tema sözleşmesi</strong>Temalar yalnız yayınlanmış mağaza verisini Storefront API üzerinden okur.</div></aside><main class="content"><div class="content-inner"><details class="mobile-nav"><summary>Storefront API bölümleri</summary><div><a href="#overview">Overview</a><a href="#quickstart">Quickstart</a><a href="#theme-coverage">Tema kapsamı</a>${mobileNav}</div></details><div class="notice" role="note"><span class="notice-label">i</span><div><strong>Storefront API, tema runtime'ı ile aynı sözleşmeyi kullanır.</strong><p>Yayınlanmış katalog, içerik ve müşteri deneyimi verileri güvenli kapsamlarla tek API yüzeyinden sunulur.</p></div></div><section id="overview" class="hero"><div><p class="eyebrow">STOREFRONT API v1</p><h1>Temalar için hızlı, güvenli ve tutarlı veri katmanı.</h1><p class="lead">Shopiyz temaları D1'e bağlanmaz. Aynı-origin Storefront Runtime veya mağazaya bağlı headless token; fiyat, varyant, menü, filtre, içerik ve kampanya verisini tek sürümlü sözleşmeden alır.</p><div class="feature-row"><div><strong>Mağaza bazlı erişim</strong><span>Her istek doğru mağaza ve yayınlanmış tema bağlamında çözülür.</span></div><div><strong>Güvenli kapsam</strong><span>İstemciler yalnız gerekli <code>storefront:read</code>, <code>storefront:checkout</code> ve müşteri kapsamlarını alır.</span></div><div><strong>Edge performansı</strong><span>Katalog ve içerik yanıtları kararlı cache politikalarıyla sunulur.</span></div></div><div class="hero-actions"><a class="button primary" href="#quickstart">Başlayın</a><a class="button" href="#runtime">Endpointleri inceleyin</a></div></div><div class="code-surface" aria-label="Storefront API istek örneği"><div class="code-bar"><span>JavaScript</span></div><pre><code>// Ana sayfa tema verisini alın
const page = await fetch(
  "/api/storefront/v1/page?pageType=home&amp;path=/"
).then((response) =&gt; response.json());

renderTheme(page);</code></pre></div></section><section class="overview-links" aria-label="Storefront API özet bağlantıları"><article><h2>Tema runtime</h2><p>Sayfa shell'i, layout ve yayınlanmış içerikleri tek payload ile alın.</p><a href="#runtime">Runtime uçlarını görüntüleyin</a></article><article><h2>Katalog ve içerik</h2><p>Ürün, koleksiyon, menü, blog ve arama verilerini aynı sözleşmeyle kullanın.</p><a href="#catalog">Katalog uçlarını görüntüleyin</a></article><article><h2>Müşteri deneyimi</h2><p>Giriş, wishlist, yorum ve checkout devrini güvenli oturumla yönetin.</p><a href="#customer">Müşteri uçlarını görüntüleyin</a></article></section><section id="quickstart" class="docs-section"><div class="section-copy"><p class="eyebrow">QUICKSTART</p><h2>Doğru istemci tipini seçerek başlayın</h2><p>Aynı-origin temalar public uçları kullanır; harici istemciler mağazaya bağlı Storefront tokenı taşır.</p></div><div class="quick-grid"><article class="card"><h3>Aynı-origin tema</h3><p>Public GET uçları token taşımadan çağrılır. Müşteri ve checkout işlemleri güvenli oturum çereziyle aynı origin'de kalır.</p><pre>const page = await fetch(
  "/api/storefront/v1/page?pageType=home&amp;path=/"
).then((response) =&gt; response.json());</pre></article><article class="card"><h3>Headless istemci</h3><p>Harici istemci için origin allowlist ve işlem bazlı en az yetki kapsamı zorunludur.</p><pre>curl -H \
  "X-Shopiyz-Storefront-Access-Token: shpft_…" \
  "https://store.myshopiyz.com/api/storefront/v1/products"</pre></article><article class="card"><h3>Koleksiyon filtreleri</h3><p>Facet değerleri ve ürünler aynı yanıtta gelir; tema yalnız URL sorgusunu yönetir.</p><pre>const listing = await fetch(
  "/api/storefront/v1/collections/all" +
  "?color=Siyah&amp;size=M&amp;sort=price-asc&amp;page=1"
).then((response) =&gt; response.json());</pre></article><article class="card"><h3>Fiyat ve kampanya</h3><p>Fiyatlar mağaza para birimiyle biçimlenir; yalnız herkese açık otomatik promosyonlar okunur.</p><pre>const localization = await fetch(
  "/api/storefront/v1/localization"
).then((response) =&gt; response.json());</pre></article></div></section>${coverage}<div id="resourceResults">${sections}</div><div class="empty-search" id="emptySearch">Aramanızla eşleşen Storefront API kaynağı bulunamadı.</div></div></main></div><script>
const toggles=Array.from(document.querySelectorAll("[data-resource-toggle]"));
const setGroupOpen=(group,open)=>{const button=group.querySelector("[data-resource-toggle]");const panel=group.querySelector(".operations");button.setAttribute("aria-expanded",String(open));button.querySelector(".resource-meta i").textContent=open?"−":"+";panel.hidden=!open};
toggles.forEach((button)=>button.addEventListener("click",()=>{const group=button.closest("[data-resource-group]");setGroupOpen(group,button.getAttribute("aria-expanded")!=="true")}));
const openHashGroup=()=>{const target=document.querySelector(location.hash||"#overview");const group=target?.closest?.("[data-resource-group]");if(group)setGroupOpen(group,true)};openHashGroup();window.addEventListener("hashchange",openHashGroup);
const sideLinks=Array.from(document.querySelectorAll("[data-sidebar-link]"));const observed=sideLinks.map((link)=>document.querySelector(link.getAttribute("href"))).filter(Boolean);const observer=new IntersectionObserver((entries)=>{const visible=entries.filter((entry)=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!visible)return;sideLinks.forEach((link)=>link.classList.toggle("active",link.getAttribute("href")==="#"+visible.target.id))},{rootMargin:"-18% 0px -68% 0px",threshold:[.05,.2,.5]});observed.forEach((section)=>observer.observe(section));
const resourceGroups=Array.from(document.querySelectorAll("[data-resource-group]"));const applySearch=(value)=>{const query=value.trim().toLowerCase();let visibleGroups=0;resourceGroups.forEach((group)=>{const cards=Array.from(group.querySelectorAll("[data-operation-card]"));let matches=0;cards.forEach((card)=>{const visible=!query||card.dataset.searchText.includes(query);card.hidden=!visible;if(visible)matches+=1});const groupText=group.textContent.toLowerCase();const groupVisible=!query||matches>0||groupText.includes(query);group.hidden=!groupVisible;if(groupVisible)visibleGroups+=1;if(query&&groupVisible)setGroupOpen(group,true)});document.getElementById("emptySearch").style.display=query&&visibleGroups===0?"block":"none";sideLinks.forEach((link)=>{const target=document.querySelector(link.getAttribute("href"));link.hidden=Boolean(query&&target&&target.dataset.resourceGroup!==undefined&&target.hidden)})};document.getElementById("sectionFilter").addEventListener("input",(event)=>applySearch(event.currentTarget.value));document.getElementById("globalSearch").addEventListener("input",(event)=>applySearch(event.currentTarget.value));
</script></body></html>`;
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
