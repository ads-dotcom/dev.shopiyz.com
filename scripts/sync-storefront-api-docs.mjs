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
const slug = (value) => String(value || "resource").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const loadCatalog = async () => {
  const contractEntry = path.join(appRoot, "src", "lib", "storefrontApiOpenApi.ts");
  for (const source of [catalogEntry, contractEntry, esbuildBin]) {
    if (!fs.existsSync(source)) throw new Error(`API source dependency is missing: ${source}`);
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shopiyz-storefront-docs-"));
  const entry = path.join(tempDir, "entry.mjs");
  const bundle = path.join(tempDir, "contract.mjs");
  try {
    fs.writeFileSync(entry, [
      `export {buildStorefrontApiCatalogPayload} from ${JSON.stringify(catalogEntry)};`,
      `export {buildStorefrontOpenApi} from ${JSON.stringify(contractEntry)};`,
    ].join("\n"));
    execFileSync(esbuildBin, [entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`], { stdio: "pipe" });
    const module = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
    return {...module.buildStorefrontApiCatalogPayload(), openApi: module.buildStorefrontOpenApi()};
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const operationContract = (catalog, operation) => catalog.openApi.paths[operation.path][operation.method.toLowerCase()];

const responseSchemaFor = (contract) => {
  const success = Object.entries(contract.responses).find(([status]) => /^2\d\d$/.test(status))?.[1];
  if (!success && contract["x-shopiyz-availability"]) return contract["x-shopiyz-availability"];
  const content = success?.content || {};
  const schema = content["application/json"]?.schema;
  return schema?.$ref?.split("/").pop() || (schema ? "JSON response" : Object.keys(content)[0] || "No response body");
};

const renderOpenApi = (catalog) => JSON.stringify(catalog.openApi, null, 2) + "\n";

const renderHtml = (catalog) => {
  const nav = catalog.resources.map((resource) => `<a href="#${slug(resource.key)}" data-sidebar-link><span>${escapeHtml(resource.name)}</span><span class="nav-count">${resource.operations.length}</span></a>`).join("");
  const mobileNav = catalog.resources.map((resource) => `<a href="#${slug(resource.key)}">${escapeHtml(resource.name)} <span>${resource.operations.length}</span></a>`).join("");
  let sections = catalog.resources.map((resource) => {
    const operations = resource.operations.map((item) => {
      const contract = operationContract(catalog, item);
      const parameters = (contract.parameters || []).map((parameter) => parameter.name).filter(Boolean);
      return `
        <article class="operation" data-operation-card data-search-text="${escapeHtml(`${item.method} ${catalog.basePath + item.path} ${item.summary} ${item.description}`.toLowerCase())}">
          <div class="operation-line"><span class="method ${item.method.toLowerCase()}"${item.method === "PATCH" ? ' style="background:#9a3412"' : ""}>${item.method}</span><code>${escapeHtml(catalog.basePath + item.path)}</code><span class="auth">${escapeHtml(item.auth)}</span></div>
          <h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.description)}</p>
          <div class="contract-row"><strong>Parametreler</strong><div class="parameter-list">${parameters.length ? parameters.map((name) => `<code>${escapeHtml(name)}</code>`).join("") : "<span>Yok</span>"}</div></div>
          <div class="contract-row"><strong>Yanıt</strong><code>${escapeHtml(responseSchemaFor(contract))}</code></div>
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
      <div class="section-copy"><p class="eyebrow">HEADLESS SECURITY</p><h2>Checkout, müşteri OAuth, newsletter ve iletişim</h2><p>Her istemci ayrı origin, redirect URI ve en az yetki kapsamıyla kaydedilir. Eski <code>storefront:read</code> tokenleri checkout veya müşteri yetkisi kazanmaz.</p></div>
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
        <article class="card"><h3>İletişim formu</h3><p>Aynı-origin tema veya <code>storefront:read</code> istemcisi mesajı mağazanın e-posta kuyruğuna aktarır. Body limiti, honeypot, tenant/IP rate limit ve isteğe bağlı Turnstile uygulanır; yanıt cache'lenmez.</p><pre>await fetch("/api/storefront/v1/contact-us", {
  method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({
    name, email, subject, message,
    locale: "de-DE", orderNumber,
    website: ""
  })
}); // 202 accepted</pre></article>
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
