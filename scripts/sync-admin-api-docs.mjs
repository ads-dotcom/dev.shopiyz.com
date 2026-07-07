import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");
const appRoot = path.resolve(process.env.SHOPIYZ_APP_REPO || path.join(docsRoot, "..", "myshopiyz"));
const appCatalogEntry = path.join(appRoot, "src", "lib", "adminApiCatalog.ts");
const esbuildBin = path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");

const generatedAt = new Date().toISOString();

const generatedDataStart = "      // BEGIN generated Admin API registry data";
const generatedDataEnd = "      // END generated Admin API registry data";
const generatedRenderStart = "      // BEGIN generated Admin API registry rendering";
const generatedRenderEnd = "      // END generated Admin API registry rendering";
const generatedSectionsStart = "      // BEGIN generated Admin API observed sections";
const generatedSectionsEnd = "      // END generated Admin API observed sections";

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} bulunamadi: ${filePath}`);
  }
}

function toTitle(value) {
  return String(value || "")
    .replace(/^catalog[._-]/, "")
    .replace(/^customers[._-]/, "")
    .replace(/^orders[._-]/, "")
    .replace(/^inventory[._-]/, "")
    .replace(/^apps[._-]/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function slug(value) {
  return String(value || "api")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "api";
}

function apiPath(pathname) {
  return pathname.startsWith("/admin/api") ? pathname : `/admin/api${pathname}`;
}

function json(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function yamlString(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9._/-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function yamlBlock(value, indent = "  ") {
  return String(value ?? "")
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function uniqueOperationId(operation, used) {
  const base = String(operation.operationId || `${operation.method}_${operation.path}`)
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "adminApiOperation";
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

const majorSections = [
  {
    id: "access",
    name: "Access",
    tag: "auth",
    icon: "KEY",
    description: "Token, scope, izin, runtime katalog ve guvenli yardimci akislar.",
    match: ({ capability, pathname }) =>
      capability.startsWith("runtime.") ||
      capability.startsWith("assistant.") ||
      pathname.startsWith("/capabilities") ||
      pathname.startsWith("/assistant/") ||
      pathname.startsWith("/access_") ||
      pathname.startsWith("/oauth/") ||
      pathname.startsWith("/api_catalog") ||
      pathname.startsWith("/permissions") ||
      pathname.startsWith("/previews") ||
      pathname.startsWith("/bulk_operations") ||
      pathname.startsWith("/entity_resolution") ||
      pathname.startsWith("/entity-resolution") ||
      pathname.startsWith("/target_sets"),
  },
  {
    id: "apps",
    name: "Apps",
    tag: "apps",
    icon: "APP",
    description: "Shopiyz uygulamalari, entegrasyon ayarlari ve app bazli operasyonlar.",
    match: ({ capability, pathname }) => capability.startsWith("apps.") || pathname.startsWith("/apps/"),
  },
  {
    id: "customers",
    name: "Customers",
    tag: "crm",
    icon: "CRM",
    description: "Musteri, adres, kategori, segment, abone, izin, gizlilik ve analitik operasyonlari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("customers.") ||
      capability.startsWith("b2b.") ||
      pathname.startsWith("/customers") ||
      pathname.startsWith("/customer_") ||
      pathname.startsWith("/subscribers") ||
      pathname.startsWith("/subscriber_") ||
      pathname.startsWith("/marketing_consents") ||
      pathname.startsWith("/suppression_list") ||
      pathname.startsWith("/privacy/customer") ||
      pathname.startsWith("/privacy/customers") ||
      pathname.startsWith("/customer_accounts") ||
      pathname.startsWith("/customer_login_events") ||
      pathname.startsWith("/abandoned_carts/customers") ||
      pathname.startsWith("/stock_notification_subscribers"),
  },
  {
    id: "gift-cards",
    name: "Gift Cards",
    tag: "gift",
    icon: "GFT",
    description: "Hediye karti, bakiye, kampanya, fraud review ve urunlestirme operasyonlari.",
    match: ({ capability, pathname }) => capability.startsWith("gift_cards") || pathname.startsWith("/gift_card") || pathname.startsWith("/gift_cards"),
  },
  {
    id: "orders",
    name: "Orders",
    tag: "orders",
    icon: "ORD",
    description: "Siparis, draft order, odeme, iade, fulfillment, kargo, fatura ve operasyon akislari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("orders.") ||
      capability.startsWith("order_") ||
      pathname.startsWith("/orders") ||
      pathname.startsWith("/order_") ||
      pathname.startsWith("/draft_orders") ||
      pathname.startsWith("/checkouts") ||
      pathname.startsWith("/refunds") ||
      pathname.startsWith("/returns") ||
      pathname.startsWith("/exchanges") ||
      pathname.startsWith("/fulfillments") ||
      pathname.startsWith("/fulfillment_") ||
      pathname.includes("/fulfillments/") ||
      pathname.startsWith("/shipments") ||
      pathname.startsWith("/shipping") ||
      pathname.startsWith("/carrier_services") ||
      pathname.startsWith("/transactions") ||
      pathname.includes("/transactions") ||
      pathname.startsWith("/payments") ||
      pathname.includes("/payments") ||
      pathname.includes("/risks"),
  },
  {
    id: "products",
    name: "Products",
    tag: "catalog",
    icon: "PRD",
    description: "Urun, varyant, koleksiyon, kategori, marka, tag, bundle, medya, SEO ve fiyat operasyonlari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("catalog.") ||
      capability.startsWith("pricing.") ||
      capability.startsWith("seo.") ||
      capability.startsWith("media.") ||
      pathname.startsWith("/products") ||
      pathname.startsWith("/product_") ||
      pathname.startsWith("/variants") ||
      pathname.startsWith("/variant_") ||
      pathname.startsWith("/collections") ||
      pathname.startsWith("/collection_") ||
      pathname.startsWith("/custom_collections") ||
      pathname.startsWith("/smart_collections") ||
      pathname.startsWith("/collects") ||
      pathname.startsWith("/categories") ||
      pathname.startsWith("/category_") ||
      pathname.startsWith("/taxonomy") ||
      pathname.startsWith("/brands") ||
      pathname.startsWith("/brand_") ||
      pathname.startsWith("/tags") ||
      pathname.startsWith("/tag_") ||
      pathname.startsWith("/bundles") ||
      pathname.startsWith("/bundle_") ||
      pathname.startsWith("/costs") ||
      pathname.startsWith("/price_") ||
      pathname.startsWith("/seo_") ||
      pathname.startsWith("/metafield") ||
      pathname.startsWith("/media_") ||
      pathname.startsWith("/files") ||
      pathname.startsWith("/resource_feedback"),
  },
  {
    id: "inventory",
    name: "Inventory",
    tag: "stock",
    icon: "INV",
    description: "Stok seviyesi, stok sayimi, transfer, satin alma, tedarikci ve stok uyarilari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("inventory.") ||
      capability === "stock_alerts" ||
      pathname.startsWith("/inventory") ||
      pathname.startsWith("/stock_") ||
      pathname.startsWith("/purchase_orders") ||
      pathname.startsWith("/suppliers") ||
      pathname.startsWith("/reorder_suggestions") ||
      pathname.startsWith("/locations"),
  },
  {
    id: "discounts",
    name: "Discounts",
    tag: "promo",
    icon: "%",
    description: "Indirim kodlari, price rule, kampanya ve promosyon operasyonlari.",
    match: ({ capability, pathname }) =>
      capability.includes("discount") ||
      capability.includes("promotion") ||
      pathname.startsWith("/discount") ||
      pathname.startsWith("/price_rules") ||
      pathname.includes("/discount_codes"),
  },
  {
    id: "online-store",
    name: "Online Store",
    tag: "web",
    icon: "WEB",
    description: "Tema, blog, sayfa, yorum, yonlendirme, asset, policy ve online store operasyonlari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("storefront.") ||
      pathname.startsWith("/themes") ||
      pathname.startsWith("/assets") ||
      pathname.startsWith("/blogs") ||
      pathname.startsWith("/articles") ||
      pathname.startsWith("/pages") ||
      pathname.startsWith("/comments") ||
      pathname.startsWith("/redirects") ||
      pathname.startsWith("/policies") ||
      pathname.startsWith("/script_tags") ||
      pathname.startsWith("/storefront") ||
      pathname.startsWith("/translations") ||
      pathname.startsWith("/translatable") ||
      pathname.startsWith("/markets") ||
      pathname.startsWith("/channels") ||
      pathname.startsWith("/mobile") ||
      pathname.startsWith("/navigation") ||
      pathname.startsWith("/menus"),
  },
  {
    id: "billing",
    name: "Billing",
    tag: "billing",
    icon: "TRY",
    description: "Abonelik, kullanim, app charge, kredi, fatura ve paket operasyonlari.",
    match: ({ capability, pathname }) =>
      capability.startsWith("billing") ||
      pathname.startsWith("/billing") ||
      pathname.startsWith("/application_charges") ||
      pathname.startsWith("/application_credits") ||
      pathname.startsWith("/recurring_application_charges") ||
      pathname.includes("/usage_charges"),
  },
  {
    id: "shopiyz-payments",
    name: "Shopiyz Payments",
    tag: "payments",
    icon: "PAY",
    description: "Odeme bakiyesi, payout, dispute, mutabakat ve finansal hareketler.",
    match: ({ capability, pathname }) =>
      capability.includes("shopiyz_payments") ||
      capability.includes("accounting") ||
      pathname.startsWith("/shopiyz_payments") ||
      pathname.startsWith("/payouts") ||
      pathname.startsWith("/disputes") ||
      pathname.startsWith("/balance") ||
      pathname.startsWith("/tender_transactions"),
  },
  {
    id: "webhooks",
    name: "Webhooks",
    tag: "webhooks",
    icon: "WH",
    description: "Webhook abonelikleri, delivery loglari, retry ve olay akis operasyonlari.",
    match: ({ capability, pathname }) => capability.includes("webhook") || pathname.startsWith("/webhooks"),
  },
  {
    id: "events",
    name: "Events",
    tag: "events",
    icon: "EVT",
    description: "Magaza olaylari, audit disi event kayitlari ve geriye donuk izleme.",
    match: ({ capability, pathname }) =>
      capability.startsWith("events.") ||
      pathname.startsWith("/events") ||
      pathname.startsWith("/event_") ||
      pathname.startsWith("/marketing_events"),
  },
  {
    id: "store-properties",
    name: "Store Properties",
    tag: "store",
    icon: "STR",
    description: "Magaza kimligi, domain, para birimi, kullanici, ayar ve store ozellikleri.",
    match: ({ capability, pathname }) =>
      capability.startsWith("store.") ||
      pathname.startsWith("/shop") ||
      pathname.startsWith("/store_") ||
      pathname.startsWith("/domains") ||
      pathname.startsWith("/countries") ||
      pathname.includes("/provinces") ||
      pathname.startsWith("/currencies") ||
      pathname.startsWith("/users") ||
      pathname.startsWith("/staff") ||
      pathname.startsWith("/settings"),
  },
  {
    id: "deprecated-api-calls",
    name: "Deprecated API Calls",
    tag: "legacy",
    icon: "OLD",
    description: "Eski, kaldirilacak veya migration gerektiren API davranislari.",
    match: ({ capability, pathname }) => capability.includes("deprecated") || pathname.startsWith("/deprecated") || pathname.startsWith("/deprecations"),
  },
  {
    id: "other-admin-api",
    name: "Other Admin API",
    tag: "api",
    icon: "API",
    description: "Diger Admin API operasyonlari ve ileride ayrilacak kaynak aileleri.",
    match: () => true,
  },
];

const displayNameOverrides = new Map([
  ["customers.customers", "Customer"],
  ["customers.addresses", "Customer Address"],
  ["customers.categories", "Customer Categories"],
  ["customers.segments", "Customer Segments"],
  ["customers.subscribers", "Subscribers"],
  ["customers.consents", "Marketing Consents"],
  ["customers.privacy", "Privacy Requests"],
  ["customers.accounts", "Customer Accounts"],
  ["customers.analytics", "Customer Analytics"],
  ["catalog.products", "Products"],
  ["catalog.variants", "Product Variants"],
  ["catalog.collections", "Collections"],
  ["catalog.categories", "Categories"],
  ["catalog.brands", "Brands"],
  ["catalog.tags", "Tags"],
  ["catalog.bundles", "Bundles"],
  ["catalog.metafields", "Metafields"],
  ["inventory.levels", "Inventory Levels"],
  ["inventory.stock_counts", "Stock Counts"],
  ["inventory.transfers", "Stock Transfers"],
  ["inventory.purchase_orders", "Purchase Orders"],
  ["orders.tags", "Order Tags"],
  ["orders.notes", "Order Notes"],
  ["orders.fulfillment", "Order Fulfillment"],
  ["orders.analytics", "Order Analytics"],
  ["runtime.catalog", "Runtime Catalog"],
  ["runtime.bulk_operations", "Bulk Operations"],
  ["runtime.target_sets", "Target Sets"],
  ["assistant.entity_resolution", "Entity Resolution"],
]);

function resourceKeyFor(operation, sectionId) {
  const capability = String(operation.capability || "");
  const parts = capability.split(/[.]/).filter(Boolean);
  const pathParts = operation.path.split("/").filter(Boolean).map((part) => part.replace(/\.json$/, ""));

  if (sectionId === "apps" && pathParts[0] === "apps") return pathParts.slice(0, 2).join(".");
  if (sectionId === "customers" && parts[0] === "customers") return parts.slice(0, 2).join(".");
  if (sectionId === "orders" && parts[0] === "orders") return parts.slice(0, 2).join(".");
  if (sectionId === "products" && parts[0] === "catalog") return parts.slice(0, 2).join(".");
  if (sectionId === "inventory" && parts[0] === "inventory") return parts.slice(0, 2).join(".");
  if (sectionId === "access" && (parts[0] === "runtime" || parts[0] === "assistant")) return parts.slice(0, 2).join(".");
  if (parts.length >= 2) return parts.slice(0, 2).join(".");
  if (parts.length === 1) return parts[0];
  return pathParts[0] || "admin_api";
}

function resourceNameFor(key) {
  if (displayNameOverrides.has(key)) return displayNameOverrides.get(key);
  const parts = key.split(/[.]/).filter(Boolean);
  return toTitle(parts.at(-1) || key);
}

function classify(operation) {
  const details = {
    capability: String(operation.capability || "").toLowerCase(),
    pathname: String(operation.path || "").toLowerCase(),
    operationId: String(operation.operationId || "").toLowerCase(),
    summary: String(operation.summary || "").toLowerCase(),
  };
  return majorSections.find((section) => section.match(details)) || majorSections.at(-1);
}

function normalizeOperation(operation, usedOperationIds) {
  return {
    method: operation.method,
    path: operation.path,
    fullPath: apiPath(operation.path),
    operationId: uniqueOperationId(operation, usedOperationIds),
    capability: operation.capability,
    summary: operation.action || operation.summary || operation.operationId,
    description: operation.description || operation.summary || operation.action || operation.operationId,
    operationKind: operation.operationKind,
    risk: operation.risk,
    confirmation: operation.confirmation,
    stepUp: operation.stepUp,
    implemented: operation.implemented !== false,
    idempotencyRequired: Boolean(operation.idempotencyRequired),
    previewRequired: Boolean(operation.previewRequired),
    rollbackSupported: Boolean(operation.rollbackSupported),
  };
}

function buildDocSections(operations) {
  const sectionMap = new Map();
  for (const section of majorSections) {
    sectionMap.set(section.id, { ...section, resources: new Map(), operations: [] });
  }

  for (const operation of operations) {
    const section = classify(operation);
    const sectionEntry = sectionMap.get(section.id);
    const key = resourceKeyFor(operation, section.id);
    const resourceId = `${section.id}-${slug(key)}-resource`;
    if (!sectionEntry.resources.has(key)) {
      sectionEntry.resources.set(key, {
        id: resourceId,
        key,
        name: resourceNameFor(key),
        description: `${resourceNameFor(key)} operasyonlari (${key}).`,
        operations: [],
      });
    }
    sectionEntry.resources.get(key).operations.push(operation);
    sectionEntry.operations.push(operation);
  }

  return Array.from(sectionMap.values())
    .filter((section) => section.operations.length > 0)
    .map((section) => ({
      id: section.id,
      name: section.name,
      tag: section.tag,
      icon: section.icon,
      description: section.description,
      operationCount: section.operations.length,
      resources: Array.from(section.resources.values())
        .map((resource) => ({
          ...resource,
          operationCount: resource.operations.length,
          operations: resource.operations.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method)),
        }))
        .sort((left, right) => right.operationCount - left.operationCount || left.name.localeCompare(right.name)),
    }));
}

async function loadCatalog() {
  assertFile(appCatalogEntry, "Admin API catalog entry");
  assertFile(esbuildBin, "esbuild binary");

  const outfile = path.join(os.tmpdir(), `shopiyz-admin-api-catalog-${process.pid}-${Date.now()}.mjs`);
  execFileSync(esbuildBin, [appCatalogEntry, "--bundle", "--platform=node", "--format=esm", `--outfile=${outfile}`], {
    cwd: appRoot,
    stdio: "ignore",
  });

  try {
    const module = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
    return {
      catalog: module.buildAdminApiCatalogPayload(generatedAt),
      capabilities: module.buildAdminApiCapabilitiesPayload(generatedAt),
    };
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

function buildDocData(catalog, capabilities) {
  const usedOperationIds = new Set();
  const operations = capabilities.operations.map((operation) => normalizeOperation(operation, usedOperationIds));
  const registeredOperations = catalog.requiredOperations.length;
  const implementedOperations = operations.filter((operation) => operation.implemented).length;
  const sections = buildDocSections(operations);

  return {
    generatedAt,
    source: "myshopiyz/src/lib/adminApiCatalog.ts",
    basePath: "/admin/api",
    openApiUrl: "https://dev.shopiyz.com/openapi/shopiyz-api.yaml",
    summary: {
      sections: sections.length,
      resources: sections.reduce((sum, section) => sum + section.resources.length, 0),
      operations: operations.length,
      registeredOperations,
      implementedOperations,
      plannedOperations: operations.length - implementedOperations,
      capabilities: capabilities.capabilities.length,
    },
    sections,
    operations,
  };
}

function replaceBetweenMarkers(source, start, end, replacement, fallbackRegex, fallbackLabel) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
  }
  if (fallbackRegex?.test(source)) return source.replace(fallbackRegex, replacement);
  throw new Error(`${fallbackLabel} bolumu index.html icinde bulunamadi.`);
}

function renderGeneratedDataBlock(docData) {
  return `${generatedDataStart}
      const adminApiDoc = ${json(docData)};
      const operationRows = adminApiDoc.operations.map((operation) => ({
        resource: operation.capability || "admin_api",
        method: operation.method,
        path: operation.fullPath,
        label: operation.summary || operation.operationId
      }));
${generatedDataEnd}

`;
}

function renderGeneratedRenderingBlock() {
  return `${generatedRenderStart}
      function createTextElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text;
        return element;
      }

      function renderRegistrySidebar() {
        const navList = document.querySelector(".nav-section.secondary .nav-list");
        if (!navList) return;
        navList.replaceChildren();

        for (const section of adminApiDoc.sections) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.className = "nav-link";
          link.href = \`#\${section.id}\`;
          link.dataset.navLink = "";
          const label = document.createElement("span");
          label.textContent = section.name;
          const arrow = document.createElement("span");
          arrow.textContent = "›";
          link.append(label, arrow);
          item.append(link);

          const subResources = section.resources.slice(0, 12);
          if (subResources.length) {
            const subnav = document.createElement("ul");
            subnav.className = "subnav";
            for (const resource of subResources) {
              const subItem = document.createElement("li");
              const subLink = document.createElement("a");
              subLink.href = \`#\${resource.id}\`;
              subLink.dataset.navLink = "";
              subLink.textContent = resource.name;
              subItem.append(subLink);
              subnav.append(subItem);
            }
            item.append(subnav);
          }

          navList.append(item);
        }

        const fixedLinks = [
          ["rate-limits", "Rate limits"],
          ["status", "Errors"],
        ];
        for (const [id, label] of fixedLinks) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.className = "nav-link";
          link.href = \`#\${id}\`;
          link.dataset.navLink = "";
          const text = document.createElement("span");
          text.textContent = label;
          const arrow = document.createElement("span");
          arrow.textContent = "›";
          link.append(text, arrow);
          item.append(link);
          navList.append(item);
        }

        const openApiItem = document.createElement("li");
        const openApiLink = document.createElement("a");
        openApiLink.className = "nav-link";
        openApiLink.href = "./openapi/shopiyz-api.yaml";
        const openApiText = document.createElement("span");
        openApiText.textContent = "OpenAPI YAML";
        const openApiArrow = document.createElement("span");
        openApiArrow.textContent = "›";
        openApiLink.append(openApiText, openApiArrow);
        openApiItem.append(openApiLink);
        navList.append(openApiItem);
      }

      function renderRegistryResourceReference() {
        const stack = document.querySelector(".resource-stack");
        if (!stack) return;
        stack.replaceChildren();

        for (const section of adminApiDoc.sections) {
          const group = document.createElement("article");
          group.className = "resource-group";
          group.id = section.id;

          const head = document.createElement("div");
          head.className = "resource-group-head";
          const headCopy = document.createElement("div");
          const title = document.createElement("h3");
          title.textContent = section.name;
          const description = document.createElement("p");
          description.textContent = section.description;
          headCopy.append(title, description);
          const tag = createTextElement("span", "resource-tag", \`\${section.operationCount} ops\`);
          head.append(headCopy, tag);

          const items = document.createElement("div");
          items.className = "resource-items registry-resource-items";

          for (const resource of section.resources) {
            const item = document.createElement("section");
            item.className = "resource-item registry-resource-item";
            item.id = resource.id;

            const resourceTitle = document.createElement("h4");
            resourceTitle.textContent = resource.name;
            const resourceDescription = document.createElement("p");
            resourceDescription.textContent = \`\${resource.operationCount} operasyon. Capability: \${resource.key}\`;

            const operationList = document.createElement("div");
            operationList.className = "resource-operation-list";

            for (const operation of resource.operations) {
              const row = document.createElement("div");
              row.className = "operation-row resource-operation-row";
              const method = createTextElement("span", "method-badge", operation.method);
              const operationPath = createTextElement("code", "operation-path", operation.fullPath);
              const label = createTextElement("span", "operation-label", operation.summary || operation.operationId);
              row.append(method, operationPath, label);
              operationList.append(row);
            }

            item.append(resourceTitle, resourceDescription, operationList);
            items.append(item);
          }

          group.append(head, items);
          stack.append(group);
        }
      }

      renderRegistryResourceReference();
      renderRegistrySidebar();
${generatedRenderEnd}

`;
}

function renderObservedSectionsBlock() {
  return `${generatedSectionsStart}
      const observedSectionIds = [
        "overview",
        "libraries",
        "authentication",
        "endpoints",
        "rate-limits",
        "status",
        "resource-reference",
        "operation-catalog",
        ...adminApiDoc.sections.flatMap((section) => [section.id, ...section.resources.map((resource) => resource.id)])
      ];
      const sections = observedSectionIds.map((id) => document.getElementById(id)).filter(Boolean);
${generatedSectionsEnd}`;
}

function updateIndexHtml(docData) {
  const indexPath = path.join(docsRoot, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");

  html = html
    .replace("<span>v1 preview</span>", "<span>unversioned</span>")
    .replace(
      "Bu sayfa ilk REST Admin API yapisini anlatir. Endpointler yayina alindikca referans bolumu genisleyecek.",
      "Bu sayfa canli Admin API registry kaynaklarindan uretilir; tek yol /admin/api altindadir."
    )
    .replace(
      "<strong>API dokumanlari preview asamasinda.</strong>",
      "<strong>API dokumanlari canli registry ile senkron tutulur.</strong>"
    )
    .replace(
      "Pagination, filtreleme ve rate limitler ilk surumun parcasi olacak.",
      "Pagination, filtreleme ve rate limitler tek Admin API yolu uzerinden belgelenir."
    )
    .replace(
      /Shopiyz Admin API kaynak haritasi genis platform mantiginda, ama ilk\s+surum icin daha okunabilir ve REST odakli tutulur\. Bu bolum canli\s+endpointleri, planlanan pathleri ve dokumanlarda yer alacak temel alanlari\s+gosterir\./,
      "Shopiyz Admin API kaynak haritasi canli runtime registry'den uretilir. Bu bolum Customer, Product, Order, Collection, Inventory ve diger tum ailelerdeki mevcut operasyonlari tek /admin/api yolu altinda gosterir."
    )
    .replace(
      /<strong>Apps endpointleri ayri kartlarda<\/strong>[\s\S]*?Her uygulamanin pathleri kendi kartinda durur; diger kaynak aileleri kapsam genisledikce canli hale gelir\./,
      "<strong>Registry kaynakli referans</strong> Bu sayfadaki kaynak kartlari, sol menu, operasyon sayilari ve OpenAPI YAML ayni Admin API registry ciktisindan uretilir."
    )
    .replace(
      /latest\.zip icindeki REST kaynak dokumanlarindan cikarilan tum operasyon\s+basliklari\. Bu tablo API kodu degil; hangi islevlerin dokumana alinacagini\s+eksiksiz izlemek icin kullanilir\./,
      "Canli Admin API registry'sinden uretilen operasyon katalogu. Bu tablo AI ve entegrasyonlarin gorecegi dokuman/OpenAPI kaynagi ile ayni listeyi kullanir."
    )
    .replace('"live + preview",\n          "REST Admin API preview"', '"live registry",\n          "REST Admin API"')
    .replace("Ilk v1 preview yayininda bu liste bos baslayabilir.", "Unversioned Admin API'de deprecated kayitlari canli registry ile izlenir.");

  html = replaceBetweenMarkers(
    html,
    generatedDataStart,
    generatedDataEnd,
    renderGeneratedDataBlock(docData),
    /      const operationCatalogRaw = `[\s\S]*?`;\n\n      const operationRows = [\s\S]*?;\n\n/,
    "operation catalog"
  );

  html = replaceBetweenMarkers(
    html,
    generatedRenderStart,
    generatedRenderEnd,
    renderGeneratedRenderingBlock(),
    /      const resourceIconLabels = \{/,
    "registry rendering"
  );
  if (!html.includes("const resourceIconLabels = {")) {
    html = html.replace(`${generatedRenderEnd}\n\n`, `${generatedRenderEnd}\n\n      const resourceIconLabels = {\n`);
  }

  html = replaceBetweenMarkers(
    html,
    generatedSectionsStart,
    generatedSectionsEnd,
    renderObservedSectionsBlock(),
    /      const sections = \[\n[\s\S]*?\n      \]\n        \.map\(\(id\) => document\.getElementById\(id\)\)\n        \.filter\(Boolean\);/,
    "observed sections"
  );

  fs.writeFileSync(indexPath, html);
  fs.copyFileSync(indexPath, path.join(docsRoot, "public", "index.html"));
}

function openApiPathParams(pathname) {
  return Array.from(pathname.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function responseBlock(status = "200") {
  return [
    `      "${status}":`,
    "        description: Successful response",
    "        content:",
    "          application/json:",
    "            schema:",
    "              $ref: \"#/components/schemas/AdminApiResponse\"",
  ].join("\n");
}

function renderOpenApiOperation(operation, tagName) {
  const lines = [];
  lines.push(`    ${operation.method.toLowerCase()}:`);
  lines.push(`      operationId: ${yamlString(operation.operationId)}`);
  lines.push("      tags:");
  lines.push(`        - ${yamlString(tagName)}`);
  lines.push(`      summary: ${yamlString(operation.summary)}`);
  lines.push("      description: |-");
  lines.push(yamlBlock(`${operation.description}\nCapability: ${operation.capability}. Risk: ${operation.risk}. Confirmation: ${operation.confirmation}. Step-up: ${operation.stepUp}.`, "        "));
  lines.push(`      x-shopiyz-capability: ${yamlString(operation.capability)}`);
  lines.push(`      x-shopiyz-risk: ${yamlString(operation.risk)}`);
  lines.push(`      x-shopiyz-confirmation: ${yamlString(operation.confirmation)}`);
  lines.push(`      x-shopiyz-step-up: ${yamlString(operation.stepUp)}`);
  lines.push(`      x-shopiyz-operation-kind: ${yamlString(operation.operationKind)}`);
  lines.push(`      x-shopiyz-implemented: ${operation.implemented ? "true" : "false"}`);
  lines.push(`      x-shopiyz-preview-required: ${operation.previewRequired ? "true" : "false"}`);
  lines.push(`      x-shopiyz-rollback-supported: ${operation.rollbackSupported ? "true" : "false"}`);

  const params = openApiPathParams(operation.path);
  if (params.length) {
    lines.push("      parameters:");
    for (const param of params) {
      lines.push(`        - name: ${yamlString(param)}`);
      lines.push("          in: path");
      lines.push("          required: true");
      lines.push("          schema:");
      lines.push("            type: string");
    }
  }

  if (!["GET", "HEAD", "DELETE"].includes(operation.method)) {
    lines.push("      requestBody:");
    lines.push("        required: false");
    lines.push("        content:");
    lines.push("          application/json:");
    lines.push("            schema:");
    lines.push("              type: object");
    lines.push("              additionalProperties: true");
  }

  lines.push("      responses:");
  lines.push(responseBlock(operation.method === "POST" ? "201" : operation.method === "DELETE" ? "200" : "200"));
  lines.push("      security:");
  lines.push("        - ShopiyzAccessToken: []");
  return lines.join("\n");
}

function renderOpenApi(docData) {
  const pathMap = new Map();
  const tagByOperation = new Map();
  for (const section of docData.sections) {
    for (const resource of section.resources) {
      for (const operation of resource.operations) {
        if (!pathMap.has(operation.path)) pathMap.set(operation.path, new Map());
        const methods = pathMap.get(operation.path);
        if (!methods.has(operation.method.toLowerCase())) {
          methods.set(operation.method.toLowerCase(), operation);
          tagByOperation.set(operation.operationId, `${section.name} / ${resource.name}`);
        }
      }
    }
  }

  const lines = [
    "openapi: 3.1.0",
    "info:",
    "  title: Shopiyz Admin API",
    "  version: unversioned",
    "  description: |-",
    yamlBlock("Shopiyz Admin API reference generated from the live Admin API registry. All endpoints use the single unversioned /admin/api base path.", "    "),
    "servers:",
    "  - url: https://{store}.shopiyz.com/admin/api",
    "    variables:",
    "      store:",
    "        default: development",
    "        description: Store subdomain or custom store host.",
    "x-shopiyz-generated-at: " + yamlString(docData.generatedAt),
    "x-shopiyz-source: " + yamlString(docData.source),
    "x-shopiyz-summary:",
    `  sections: ${docData.summary.sections}`,
    `  resources: ${docData.summary.resources}`,
    `  operations: ${docData.summary.operations}`,
    `  registeredOperations: ${docData.summary.registeredOperations}`,
    `  implementedOperations: ${docData.summary.implementedOperations}`,
    `  capabilities: ${docData.summary.capabilities}`,
    "paths:",
  ];

  for (const [pathname, methods] of Array.from(pathMap.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${pathname}:`);
    for (const method of ["get", "post", "put", "patch", "delete", "head"]) {
      const operation = methods.get(method);
      if (!operation) continue;
      lines.push(renderOpenApiOperation(operation, tagByOperation.get(operation.operationId) || "Admin API"));
    }
  }

  lines.push("components:");
  lines.push("  securitySchemes:");
  lines.push("    ShopiyzAccessToken:");
  lines.push("      type: apiKey");
  lines.push("      in: header");
  lines.push("      name: X-Shopiyz-Access-Token");
  lines.push("  schemas:");
  lines.push("    AdminApiResponse:");
  lines.push("      type: object");
  lines.push("      additionalProperties: true");
  lines.push("    AdminApiError:");
  lines.push("      type: object");
  lines.push("      properties:");
  lines.push("        error:");
  lines.push("          type: object");
  lines.push("          additionalProperties: true");
  lines.push("security:");
  lines.push("  - ShopiyzAccessToken: []");
  return `${lines.join("\n")}\n`;
}

function updateOpenApi(docData) {
  const yaml = renderOpenApi(docData);
  const targets = [
    path.join(docsRoot, "openapi", "shopiyz-api.yaml"),
    path.join(docsRoot, "openapi", "shopiyz-api.v1.yaml"),
    path.join(docsRoot, "public", "openapi", "shopiyz-api.yaml"),
    path.join(docsRoot, "public", "openapi", "shopiyz-api.v1.yaml"),
  ];
  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, yaml);
  }
}

function updateReadme() {
  const replacements = [
    [path.join(docsRoot, "README.md"), "`openapi/shopiyz-api.yaml` is generated from the live Admin API registry and is the AI/integration source of truth."],
    [path.join(docsRoot, "public", "README.md"), "`openapi/shopiyz-api.yaml` is generated from the live Admin API registry and is the AI/integration source of truth."],
  ];
  for (const [readmePath, line] of replacements) {
    if (!fs.existsSync(readmePath)) continue;
    const current = fs.readFileSync(readmePath, "utf8");
    fs.writeFileSync(readmePath, current.replace("`openapi/shopiyz-api.yaml` is a placeholder OpenAPI document.", line));
  }
}

const { catalog, capabilities } = await loadCatalog();
const docData = buildDocData(catalog, capabilities);
updateIndexHtml(docData);
updateOpenApi(docData);
updateReadme();

console.log(
  JSON.stringify(
    {
      generatedAt,
      operations: docData.summary.operations,
      registeredOperations: docData.summary.registeredOperations,
      resources: docData.summary.resources,
      sections: docData.summary.sections,
      capabilities: docData.summary.capabilities,
    },
    null,
    2
  )
);
