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
  if (["/page", "/shop", "/products", "/collections", "/menus", "/search"].includes(operation.path)) names.push("storeId", "preview", "previewThemeId", "designId");
  if (operation.path === "/page") names.push("pageType", "path", "product", "collection", "blog", "blogPost", "page", "policy", "limit");
  if (operation.path === "/products" || operation.path.startsWith("/collections")) names.push("limit");
  if (operation.path === "/search") names.push("q", "searchPage", "limit", "searchSort", "searchType", "searchVendor", "searchCategory", "searchAvailability", "searchPriceMax");
  if (["/smart-search", "/quick-view-product", "/product-viewers", "/cart-recovery-cart", "/image"].includes(operation.path)) names.push("storeId");
  if (operation.path === "/image") names.push("source", "width", "quality", "format");
  if (operation.path === "/smart-search") names.push("q", "limit", "sessionId", "deviceType");
  if (operation.path === "/quick-view-product") names.push("product", "products", "preview", "revision");
  if (operation.path === "/product-viewers") names.push("productId", "productHandle", "windowSeconds");
  if (operation.path === "/cart-recovery-cart") names.push("cartToken");
  return Array.from(new Set(names));
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
          lines.push(`        - name: ${name}`, "          in: query", "          required: false", `          schema: { type: ${["preview", "searchAvailability"].includes(name) ? "boolean" : ["limit", "searchPage", "width", "quality", "windowSeconds"].includes(name) ? "integer" : "string"} }`);
        }
      }
      if (operation.method === "POST") {
        lines.push("      requestBody:", "        required: true", "        content:", "          application/json:", "            schema:", "              type: object", "              additionalProperties: true");
      }
      lines.push("      responses:", "        '200':", "          description: Successful Storefront response", "          content:", "            application/json:", "              schema:", "                $ref: '#/components/schemas/StorefrontResponse'", "        '400':", "          $ref: '#/components/responses/BadRequest'", "        '401':", "          $ref: '#/components/responses/Unauthorized'", "        '403':", "          $ref: '#/components/responses/Forbidden'", "        '404':", "          $ref: '#/components/responses/NotFound'", "        '429':", "          $ref: '#/components/responses/RateLimited'", "        '500':", "          $ref: '#/components/responses/InternalError'");
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
  const sections = catalog.resources.map((resource) => `
    <section id="${slug(resource.key)}" class="resource">
      <div class="resource-head"><div><p class="eyebrow">RESOURCE</p><h2>${escapeHtml(resource.name)}</h2><p>${escapeHtml(resource.description)}</p></div><strong>${resource.operations.length} endpoint</strong></div>
      <div class="operations">${resource.operations.map((item) => `
        <article class="operation">
          <div class="operation-line"><span class="method ${item.method.toLowerCase()}">${item.method}</span><code>${escapeHtml(catalog.basePath + item.path)}</code><span class="auth">${escapeHtml(item.auth)}</span></div>
          <h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.description)}</p>
          <div class="meta"><span>Cache: ${escapeHtml(item.cache)}</span>${item.scope ? `<span>Scope: ${escapeHtml(item.scope)}</span>` : ""}</div>
        </article>`).join("")}</div>
    </section>`).join("");
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shopiyz Storefront API</title><meta name="description" content="Shopiyz Storefront API v1 dokümantasyonu"><link rel="icon" href="./favicon.svg"><style>
:root{--ink:#111;--muted:#646464;--line:#e5e5e5;--soft:#f7f7f7;--blue:#075985;--green:#166534}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);font:15px/1.6 Inter,ui-sans-serif,system-ui;background:#fff}a{color:inherit}.topbar{position:sticky;top:0;z-index:10;display:grid;grid-template-columns:270px 1fr auto;align-items:center;min-height:72px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}.brand{display:flex;align-items:center;gap:10px;padding:0 26px;font-weight:800;text-decoration:none}.brand img{width:34px;height:34px}.tabs{display:flex;justify-content:center;gap:8px}.tabs a{padding:9px 13px;border-radius:8px;text-decoration:none;font-weight:700}.tabs .active{background:#111;color:#fff}.topbar>.openapi{margin-right:24px;padding:9px 13px;border:1px solid var(--line);border-radius:8px;text-decoration:none;font-weight:700}.layout{display:grid;grid-template-columns:270px minmax(0,1fr)}aside{position:sticky;top:72px;height:calc(100vh - 72px);padding:24px 18px;border-right:1px solid var(--line);overflow:auto}aside p{margin:0 10px 12px;color:#8a8a8a;font-size:12px;font-weight:800;letter-spacing:.12em}aside a{display:flex;justify-content:space-between;padding:9px 10px;border-radius:7px;text-decoration:none}aside a:hover{background:var(--soft)}aside span{color:#999}main{min-width:0}.container{max-width:1120px;margin:auto;padding:52px 42px 100px}.hero{padding:42px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(135deg,#f4f4f4,#fff 55%)}.eyebrow{margin:0 0 8px;color:#666;font-size:12px;font-weight:850;letter-spacing:.14em}.hero h1{max-width:780px;margin:0 0 16px;font-size:48px;line-height:1.05}.hero>p{max-width:760px;color:var(--muted);font-size:18px}.badges,.meta{display:flex;flex-wrap:wrap;gap:8px}.badges span,.meta span,.auth{padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:12px}.architecture{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:28px}.architecture div{padding:16px;border:1px solid var(--line);border-radius:9px;background:#fff;font-weight:750;text-align:center}.architecture b{display:block;color:#777;font-size:11px}.guide{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:24px 0 54px}.card{padding:24px;border:1px solid var(--line);border-radius:10px}.card h2{margin:0 0 8px}.card pre{overflow:auto;padding:16px;border-radius:8px;background:#111;color:#f5f5f5;font:13px/1.5 ui-monospace,SFMono-Regular,monospace}.resource{scroll-margin-top:90px;margin-top:54px}.resource-head{display:flex;justify-content:space-between;gap:20px;align-items:start;padding-bottom:18px;border-bottom:1px solid var(--line)}.resource-head h2{margin:0}.resource-head p:last-child{max-width:760px;margin:6px 0 0;color:var(--muted)}.resource-head>strong{white-space:nowrap}.operations{display:grid;gap:12px;margin-top:18px}.operation{padding:20px;border:1px solid var(--line);border-radius:9px}.operation-line{display:flex;align-items:center;gap:10px;min-width:0}.operation-line code{overflow:auto;font:13px ui-monospace,SFMono-Regular,monospace}.method{min-width:48px;padding:4px 7px;border-radius:5px;color:#fff;font-size:11px;font-weight:900;text-align:center}.method.get{background:var(--blue)}.method.post{background:var(--green)}.operation h3{margin:15px 0 5px}.operation p{margin:0 0 12px;color:var(--muted)}@media(max-width:820px){.topbar{grid-template-columns:1fr auto}.tabs{grid-column:1/-1;grid-row:2;padding:8px;border-top:1px solid var(--line)}.layout{display:block}aside{display:none}.container{padding:28px 18px 70px}.hero{padding:26px}.hero h1{font-size:36px}.architecture{grid-template-columns:1fr 1fr}.guide{grid-template-columns:1fr}.topbar>.openapi{margin-right:14px}}
</style></head><body><header class="topbar"><a class="brand" href="./"><img src="./favicon.svg" alt=""><span>Shopiyz <strong>Docs</strong></span></a><nav class="tabs" aria-label="API seçimi"><a href="./">Admin API</a><a class="active" href="./storefront.html">Storefront API</a></nav><a class="openapi" href="./openapi/shopiyz-storefront-api.yaml">OpenAPI</a></header><div class="layout"><aside><p>STOREFRONT API</p><a href="#overview">Overview</a><a href="#quickstart">Quickstart</a>${nav}</aside><main><div class="container"><section id="overview" class="hero"><p class="eyebrow">STOREFRONT API v1</p><h1>Temalar için tek, hızlı ve güvenli veri sözleşmesi.</h1><p>Shopiyz temaları D1'e bağlanmaz. Aynı origin Storefront Runtime bu API'yi çağırır; API Worker tarafında mağazanın D1 ve R2 binding'leriyle veriyi hazırlar.</p><div class="badges"><span>${catalog.summary.resources} kaynak</span><span>${catalog.summary.operations} endpoint</span><span>storefront:read</span><span>Edge cache</span></div><div class="architecture"><div><b>1</b>D1 / R2</div><div><b>2</b>Storefront API v1</div><div><b>3</b>Ortak Runtime</div><div><b>4</b>Tema 1…300</div></div></section><section id="quickstart" class="guide"><article class="card"><h2>Aynı origin tema</h2><p>Shopiyz temaları public GET uçlarını token taşımadan çağırır. Müşteri ve checkout işlemleri güvenli oturum çereziyle aynı origin'de kalır.</p><pre>const page = await fetch(
  "/api/storefront/v1/page?pageType=home&path=/"
).then(r =&gt; r.json());</pre></article><article class="card"><h2>Headless istemci</h2><p>Harici istemci mağazaya bağlı Storefront tokenı kullanır. Token yalnızca <code>storefront:read</code> kapsamına sahiptir.</p><pre>curl -H \
  "X-Shopiyz-Storefront-Access-Token: shpft_…" \
  "https://store.myshopiyz.com/api/storefront/v1/products"</pre></article></section>${sections}</div></main></div></body></html>`;
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
