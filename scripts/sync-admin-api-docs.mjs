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
const DEFAULT_ADMIN_API_BASE_PATH = "/admin/api/v1";

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

function apiPath(pathname, basePath = DEFAULT_ADMIN_API_BASE_PATH) {
  if (pathname.startsWith(`${basePath}/`) || pathname === basePath) return pathname;
  const relativePath = pathname.replace(/^\/admin\/api(?:\/v1)?/, "") || "/";
  return `${basePath}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
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

function yamlList(values, indent = "        ") {
  return values.map((value) => `${indent}- ${yamlString(value)}`).join("\n");
}

function yamlScalar(value) {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return yamlString(value);
}

function yamlValue(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${prefix}[]`];
    const lines = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        lines.push(`${prefix}-`);
        lines.push(...yamlValue(item, indent + 2));
      } else {
        lines.push(`${prefix}- ${yamlScalar(item)}`);
      }
    }
    return lines;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
    if (!entries.length) return [`${prefix}{}`];
    const lines = [];
    for (const [key, entryValue] of entries) {
      if (entryValue && typeof entryValue === "object") {
        lines.push(`${prefix}${key}:`);
        lines.push(...yamlValue(entryValue, indent + 2));
      } else {
        lines.push(`${prefix}${key}: ${yamlScalar(entryValue)}`);
      }
    }
    return lines;
  }
  return [`${prefix}${yamlScalar(value)}`];
}

function pushYaml(lines, key, value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (value && typeof value === "object") {
    lines.push(`${prefix}${key}:`);
    lines.push(...yamlValue(value, indent + 2));
  } else {
    lines.push(`${prefix}${key}: ${yamlScalar(value)}`);
  }
}

function standardOperationKind(operation) {
  const pathText = `${operation.path} ${operation.capability} ${operation.operationId}`.toLowerCase();
  if (pathText.includes("bulk")) return "bulk_mutation";
  if (pathText.includes("analytics") || pathText.includes("report") || pathText.includes("suggestion") || operation.operationKind === "analysis") return "analytics";
  if (pathText.includes("moderation") || pathText.includes("approve") || pathText.includes("reject") || pathText.includes("spam")) return "moderation";
  if (pathText.includes("settings") || pathText.includes("config") || pathText.includes("rules")) return "configuration";
  if (operation.method === "GET" || operation.operationKind === "read" || operation.operationKind === "audit") return "query";
  return "mutation";
}

function standardConfirmation(confirmation) {
  if (confirmation === "approval") return "preview";
  if (confirmation === "manual_review") return "explicit";
  return confirmation || "none";
}

function standardStepUp(stepUp) {
  if (stepUp === "conditional") return "optional";
  if (stepUp === "mfa") return "required";
  return stepUp || "none";
}

function standardIdempotency(operation) {
  if (operation.idempotencyRequired) return "required";
  if (["POST", "PUT", "PATCH", "DELETE"].includes(operation.method)) return "recommended";
  return "none";
}

const ref = (schemaName) => ({ $ref: `#/components/schemas/${schemaName}` });
const headerRef = (headerName) => ({ $ref: `#/components/headers/${headerName}` });
const nullableString = { type: ["string", "null"] };
const dateTimeString = { type: "string", format: "date-time", example: "2026-07-10T00:00:00.000Z" };
const idString = (example) => ({ type: "string", example });
const moneyNumber = { type: "number", example: 1299 };

const OPENAPI_RATE_LIMIT_HEADERS = {
  XShopiyzApiCallLimit: { schema: { type: "string", example: "12/40" }, description: "Current visible leaky bucket usage and bucket size." },
  XShopiyzApiBucketSize: { schema: { type: "integer", example: 40 }, description: "Visible leaky bucket size for the request." },
  XShopiyzApiRestoreRate: { schema: { type: "number", example: 2 }, description: "Bucket leak/restore rate per second." },
  XShopiyzApiCost: { schema: { type: "integer", example: 3 }, description: "Cost charged for this operation." },
  XShopiyzRateLimitRemaining: { schema: { type: "integer", example: 28 }, description: "Remaining capacity in the visible bucket after this request." },
  XShopiyzAPILimit: { schema: { type: "integer", example: 40 }, description: "Developer-friendly alias for the visible API bucket size." },
  XShopiyzAPIRemaining: { schema: { type: "integer", example: 28 }, description: "Developer-friendly alias for remaining API bucket capacity." },
  XShopiyzAPIRestoreRate: { schema: { type: "number", example: 2 }, description: "Developer-friendly alias for bucket restore rate per second." },
  XShopiyzAPIRetryAfter: { schema: { type: "integer", example: 0 }, description: "Developer-friendly retry-after alias; non-zero when the request is throttled." },
  XRequestId: { schema: { type: "string", example: "req_01HYSHOPIYZ" }, description: "Request correlation id for support and logs." },
  XShopiyzRateLimitReset: { schema: { type: "string", format: "date-time" }, description: "Approximate UTC time when a limited bucket has capacity again." },
  RetryAfter: { schema: { type: "integer", minimum: 1, example: 2 }, description: "Seconds to wait before retrying after a 429 response." },
};

const successRateLimitHeaderRefs = [
  ["X-Shopiyz-Api-Call-Limit", "XShopiyzApiCallLimit"],
  ["X-Shopiyz-Api-Bucket-Size", "XShopiyzApiBucketSize"],
  ["X-Shopiyz-Api-Restore-Rate", "XShopiyzApiRestoreRate"],
  ["X-Shopiyz-Api-Cost", "XShopiyzApiCost"],
  ["X-Shopiyz-RateLimit-Remaining", "XShopiyzRateLimitRemaining"],
  ["X-Shopiyz-API-Limit", "XShopiyzAPILimit"],
  ["X-Shopiyz-API-Remaining", "XShopiyzAPIRemaining"],
  ["X-Shopiyz-API-Restore-Rate", "XShopiyzAPIRestoreRate"],
  ["X-Shopiyz-API-Retry-After", "XShopiyzAPIRetryAfter"],
  ["X-Request-Id", "XRequestId"],
];

const rateLimit429HeaderRefs = [
  ...successRateLimitHeaderRefs,
  ["Retry-After", "RetryAfter"],
  ["X-Shopiyz-RateLimit-Reset", "XShopiyzRateLimitReset"],
];

const OPENAPI_COMPONENT_SCHEMAS = {
  AdminApiResponse: {
    type: "object",
    description: "Generic response wrapper for endpoints that do not yet expose a typed schema.",
    additionalProperties: true,
  },
  AdminApiMutationRequest: {
    type: "object",
    description: "Generic mutation payload for planned endpoints where the exact runtime request body is not yet verified.",
    additionalProperties: true,
  },
  AdminApiError: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["message"],
        properties: {
          code: { type: "string", example: "invalid_request" },
          message: { type: "string", example: "Request payload is invalid." },
          request_id: { type: ["string", "null"], example: "req_01HYSHOPIYZ" },
          requestId: { type: ["string", "null"], deprecated: true, description: "Legacy camelCase alias kept for backwards-compatible clients." },
          details: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  RateLimitError: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "details", "request_id"],
        properties: {
          code: { type: "string", example: "rate_limited" },
          message: { type: "string", example: "API rate limit exceeded. Retry after the indicated delay." },
          request_id: { type: "string", example: "req_01HYSHOPIYZ" },
          details: {
            type: "object",
            required: ["bucket_size", "currently_used", "restore_rate", "retry_after", "cost"],
            properties: {
              bucket_size: { type: "integer", example: 40 },
              currently_used: { type: "integer", example: 41 },
              restore_rate: { type: "number", example: 2 },
              retry_after: { type: "integer", example: 1 },
              cost: { type: "integer", example: 3 },
              group: { type: "string", example: "products" },
              scope: { type: "string", example: "resource" },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
      legacy_error: { type: "string", example: "Admin API rate limit aşıldı." },
    },
    additionalProperties: true,
  },
  ValidationError: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string", example: "validation_error" },
          message: { type: "string", example: "One or more fields are invalid." },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string", example: "product.title" },
                message: { type: "string", example: "Title is required." },
              },
            },
          },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  PaginationInfo: {
    type: "object",
    properties: {
      total: { type: "integer", example: 1 },
      total_count: { type: "integer", example: 1 },
      limit: { type: "integer", example: 50 },
      offset: { type: "integer", example: 0 },
      count: { type: "integer", example: 1 },
      cursor: nullableString,
      nextCursor: nullableString,
      next_cursor: nullableString,
      nextOffset: { type: ["integer", "null"], example: null },
      next_offset: { type: ["integer", "null"], example: null },
      previousOffset: { type: ["integer", "null"], example: null },
      previous_offset: { type: ["integer", "null"], example: null },
      pageInfo: nullableString,
      page_info: nullableString,
      nextPageInfo: nullableString,
      next_page_info: nullableString,
      previousPageInfo: nullableString,
      previous_page_info: nullableString,
      hasMore: { type: "boolean", example: false },
      has_more: { type: "boolean", example: false },
      hasNextPage: { type: "boolean", example: false },
      has_next_page: { type: "boolean", example: false },
      hasPreviousPage: { type: "boolean", example: false },
      has_previous_page: { type: "boolean", example: false },
      countReturned: { type: "integer", example: 1 },
      count_returned: { type: "integer", example: 1 },
    },
    additionalProperties: true,
  },
  Page: {
    type: "object",
    required: ["id", "store_id", "title", "handle", "status"],
    properties: {
      id: idString("page_impressum"),
      store_id: idString("store_demo"),
      title: { type: "string", example: "Impressum" },
      handle: { type: "string", example: "impressum" },
      slug: { type: "string", example: "impressum" },
      body_html: nullableString,
      body_markdown: nullableString,
      summary: nullableString,
      seo_title: nullableString,
      seo_description: nullableString,
      template_suffix: nullableString,
      status: { type: "string", enum: ["draft", "published", "hidden", "archived"], example: "published" },
      published_at: { type: ["string", "null"], format: "date-time" },
      author: nullableString,
      locale: { type: "string", example: "de" },
      sort_order: { type: "integer", example: 0 },
      url: { type: "string", example: "/pages/impressum" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  PageInput: {
    type: "object",
    description: "Create/update payload for static online-store pages. Server generated identifiers, URLs and timestamps are intentionally excluded.",
    required: ["title"],
    properties: {
      title: { type: "string", example: "Impressum" },
      handle: { type: "string", example: "impressum" },
      slug: { type: "string", example: "impressum" },
      body_html: { type: ["string", "null"], example: "<h1>Impressum</h1>" },
      body_markdown: { type: ["string", "null"], example: "# Impressum\n..." },
      summary: nullableString,
      seo_title: { type: ["string", "null"], example: "Impressum - Shopiyz" },
      seo_description: { type: ["string", "null"], example: "Rechtliche Anbieterkennzeichnung des Shops." },
      template_suffix: nullableString,
      status: { type: "string", enum: ["draft", "published", "hidden", "archived"], example: "published" },
      author: nullableString,
      locale: { type: "string", example: "de" },
      sort_order: { type: "integer", example: 0 },
    },
    additionalProperties: true,
    example: { title: "Impressum", handle: "impressum", body_markdown: "# Impressum\nAngaben gem. § 5 TMG", status: "published", locale: "de" },
  },
  PageRequest: {
    type: "object",
    description: "Accepts either { page: {...} } or the page fields at the top level. Write calls require Idempotency-Key.",
    properties: {
      page: ref("PageInput"),
      upsert: { type: "boolean", example: true },
      mode: { type: "string", enum: ["create", "upsert"], example: "upsert" },
    },
    additionalProperties: true,
  },
  PageResponse: {
    type: "object",
    properties: {
      page: ref("Page"),
      data: ref("Page"),
    },
    additionalProperties: true,
  },
  PageListResponse: {
    type: "object",
    properties: {
      pages: { type: "array", items: ref("Page") },
      data: { type: "array", items: ref("Page") },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  PageImportResponse: {
    type: "object",
    properties: {
      imported: { type: "integer", example: 3 },
      pages: { type: "array", items: ref("Page") },
      results: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  },
  ArticleRequest: {
    type: "object",
    properties: {
      article: {
        type: "object",
        properties: {
          title: { type: "string", example: "Standing desk setup guide" },
          handle: { type: "string", example: "standing-desk-setup-guide" },
          blog_id: nullableString,
          body_html: { type: ["string", "null"], example: "<p>Setup guide...</p>" },
          body_markdown: { type: ["string", "null"], example: "# Setup guide" },
          summary: nullableString,
          author: nullableString,
          tags: { type: "array", items: { type: "string" }, example: ["ergonomics"] },
          status: { type: "string", enum: ["draft", "published", "archived"], example: "draft" },
          seo_title: nullableString,
          seo_description: nullableString,
          published_at: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  BlogRequest: {
    type: "object",
    properties: {
      blog: {
        type: "object",
        properties: {
          title: { type: "string", example: "Guides" },
          handle: { type: "string", example: "guides" },
          description: nullableString,
          status: { type: "string", enum: ["draft", "published", "archived"], example: "published" },
          seo_title: nullableString,
          seo_description: nullableString,
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  CommentRequest: {
    type: "object",
    properties: {
      comment: {
        type: "object",
        properties: {
          article_id: nullableString,
          author: nullableString,
          email: { type: ["string", "null"], format: "email" },
          body: { type: "string", example: "Helpful guide." },
          status: { type: "string", enum: ["pending", "approved", "spam", "rejected"], example: "pending" },
          reply: nullableString,
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  CommentModerationRequest: {
    type: "object",
    properties: {
      reason: nullableString,
      note: nullableString,
      reply: nullableString,
      notify_author: { type: "boolean", example: false },
      apply: { type: "boolean", example: false },
    },
    additionalProperties: true,
  },
  ContentActionRequest: {
    type: "object",
    properties: {
      action: { type: "string", example: "schedule_publish" },
      locale: { type: "string", example: "de" },
      scheduled_at: { type: ["string", "null"], format: "date-time" },
      target_locale: { type: ["string", "null"], example: "en" },
      fields: { type: "array", items: { type: "string" }, example: ["title", "body_html", "seo_title"] },
      options: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  ContentImportExportRequest: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["jsonl", "csv", "html"], example: "jsonl" },
      source_url: { type: ["string", "null"], format: "uri" },
      filters: { type: "object", additionalProperties: true },
      dry_run: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  ContentResourceResponse: {
    type: "object",
    properties: {
      article: { type: "object", additionalProperties: true },
      blog: { type: "object", additionalProperties: true },
      comment: { type: "object", additionalProperties: true },
      job: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  Policy: {
    type: "object",
    required: ["id", "type", "title", "handle"],
    properties: {
      id: idString("policy_privacy_policy"),
      type: {
        type: "string",
        enum: ["privacy_policy", "refund_policy", "terms_of_service", "shipping_policy", "legal_notice", "contact_information", "withdrawal_policy", "withdrawal_form", "payment_policy"],
        example: "privacy_policy",
      },
      title: { type: "string", example: "Datenschutzerklärung" },
      handle: { type: "string", example: "privacy-policy" },
      body_html: nullableString,
      body_markdown: nullableString,
      url: { type: "string", example: "/policies/privacy-policy" },
      published: { type: "boolean", example: true },
      required_in_checkout: { type: "boolean", example: true },
      show_in_footer: { type: "boolean", example: true },
      locale: { type: "string", example: "de" },
      version: { type: "integer", example: 1 },
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  PolicyInput: {
    type: "object",
    description: "Create/update payload for legal policy content. Read-only id, url, version and timestamps are excluded.",
    required: ["type", "title"],
    properties: {
      type: {
        type: "string",
        enum: ["privacy_policy", "refund_policy", "terms_of_service", "shipping_policy", "legal_notice", "contact_information", "withdrawal_policy", "withdrawal_form", "payment_policy"],
        example: "privacy_policy",
      },
      title: { type: "string", example: "Datenschutzerklärung" },
      handle: { type: "string", example: "datenschutzerklaerung" },
      body_html: { type: ["string", "null"], example: "<h1>Datenschutzerklärung</h1>" },
      body_markdown: { type: ["string", "null"], example: "# Datenschutzerklärung\n..." },
      published: { type: "boolean", example: true },
      required_in_checkout: { type: "boolean", example: true },
      show_in_footer: { type: "boolean", example: true },
      locale: { type: "string", example: "de" },
    },
    additionalProperties: true,
    example: { type: "privacy_policy", title: "Datenschutzerklärung", body_markdown: "# Datenschutz", published: true, show_in_footer: true, locale: "de" },
  },
  PolicySettingsInput: {
    type: "object",
    description: "Bulk policy settings update payload.",
    properties: {
      policies: { type: "array", items: ref("PolicyInput") },
    },
    additionalProperties: true,
    example: { policies: [{ type: "privacy_policy", title: "Datenschutzerklärung", body_markdown: "# Datenschutz", published: true }] },
  },
  PolicySettingsRequest: {
    type: "object",
    properties: {
      policies: { type: "array", items: ref("PolicyInput") },
      settings: ref("PolicySettingsInput"),
    },
    additionalProperties: true,
  },
  PolicySettingsResponse: {
    type: "object",
    properties: {
      policies: { type: "array", items: ref("Policy") },
      data: { type: "array", items: ref("Policy") },
      updated: { type: "integer", example: 1 },
    },
    additionalProperties: true,
  },
  LegalDocument: {
    type: "object",
    required: ["id", "type", "title", "handle", "status"],
    properties: {
      id: idString("legal_doc_001"),
      store_id: idString("store_demo"),
      type: { type: "string", example: "legal_notice" },
      title: { type: "string", example: "Impressum" },
      handle: { type: "string", example: "impressum" },
      body_html: nullableString,
      body_markdown: nullableString,
      url: { type: "string", example: "/pages/impressum" },
      published: { type: "boolean", example: true },
      required_in_checkout: { type: "boolean", example: false },
      show_in_footer: { type: "boolean", example: true },
      locale: { type: "string", example: "de" },
      canonical_url: nullableString,
      version: { type: "integer", example: 1 },
      status: { type: "string", enum: ["draft", "published", "hidden", "archived"], example: "published" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  LegalDocumentInput: {
    type: "object",
    description: "Create/update payload for legal documents and policy-like pages.",
    required: ["type", "title"],
    properties: {
      type: { type: "string", example: "legal_notice" },
      title: { type: "string", example: "Impressum" },
      handle: { type: "string", example: "impressum" },
      body_html: { type: ["string", "null"], example: "<h1>Impressum</h1>" },
      body_markdown: { type: ["string", "null"], example: "# Impressum\n..." },
      published: { type: "boolean", example: true },
      required_in_checkout: { type: "boolean", example: false },
      show_in_footer: { type: "boolean", example: true },
      locale: { type: "string", example: "de" },
      canonical_url: nullableString,
      status: { type: "string", enum: ["draft", "published", "hidden", "archived"], example: "published" },
    },
    additionalProperties: true,
    example: { type: "legal_notice", title: "Impressum", handle: "impressum", body_markdown: "# Impressum", published: true, locale: "de" },
  },
  LegalDocumentRequest: {
    type: "object",
    description: "Accepts either { legal_document: {...} }, { document: {...} } or fields at the top level. Write calls require Idempotency-Key.",
    properties: {
      legal_document: ref("LegalDocumentInput"),
      document: ref("LegalDocumentInput"),
      upsert: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  LegalDocumentResponse: {
    type: "object",
    properties: {
      legal_document: ref("LegalDocument"),
      data: ref("LegalDocument"),
    },
    additionalProperties: true,
  },
  LegalDocumentListResponse: {
    type: "object",
    properties: {
      legal_documents: { type: "array", items: ref("LegalDocument") },
      data: { type: "array", items: ref("LegalDocument") },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  LegalDocumentBundleRequest: {
    type: "object",
    properties: {
      locale: { type: "string", example: "de" },
      mode: { type: "string", enum: ["upsert", "preview"], example: "upsert" },
      publish: { type: "boolean", example: true },
      link_footer_menu: { type: "boolean", example: true },
      pages: { type: "array", items: ref("PageInput") },
      policies: { type: "array", items: ref("PolicyInput") },
      menu: ref("MenuInput"),
    },
    additionalProperties: true,
    example: { locale: "de", mode: "upsert", publish: true, link_footer_menu: true, pages: [{ title: "Impressum", handle: "impressum", body_markdown: "# Impressum" }], policies: [{ type: "privacy_policy", title: "Datenschutz", body_markdown: "# Datenschutz" }], menu: { handle: "footer", items: [{ title: "Impressum", url: "/pages/impressum" }] } },
  },
  LegalDocumentBundleInput: {
    type: "object",
    description: "Shopiyz legal page, policy and footer-menu bundle input. preview_bundle reads this without writes; apply_bundle upserts idempotently.",
    properties: {
      locale: { type: "string", example: "de" },
      mode: { type: "string", enum: ["upsert", "preview"], example: "upsert" },
      publish: { type: "boolean", example: true },
      link_footer_menu: { type: "boolean", example: true },
      pages: { type: "array", items: ref("PageInput") },
      policies: { type: "array", items: ref("PolicyInput") },
      menu: ref("MenuInput"),
    },
    additionalProperties: true,
    example: { locale: "de", pages: [{ title: "Impressum", handle: "impressum" }], policies: [{ type: "privacy_policy", title: "Datenschutz" }] },
  },
  LegalDocumentBundlePreviewResponse: {
    type: "object",
    properties: {
      preview: {
        type: "object",
        properties: {
          create: { type: "array", items: { type: "string" } },
          update: { type: "array", items: { type: "string" } },
          noop: { type: "array", items: { type: "string" } },
          handle_collisions: { type: "array", items: { type: "object", additionalProperties: true } },
          footer_links_to_add: { type: "array", items: { type: "object", additionalProperties: true } },
          rollback_id: idString("rollback_001"),
          validation_warnings: { type: "array", items: { type: "string" } },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  LegalDocumentBundleApplyResponse: {
    type: "object",
    properties: {
      applied: { type: "boolean", example: true },
      request_id: idString("req_01HYSHOPIYZ"),
      rollback_id: idString("rollback_001"),
      created: { type: "array", items: { type: "string" } },
      updated: { type: "array", items: { type: "string" } },
      noop: { type: "array", items: { type: "string" } },
      public_urls: { type: "array", items: { type: "string" } },
      menu_update: { type: "object", additionalProperties: true },
      preview: ref("LegalDocumentBundlePreviewResponse"),
    },
    additionalProperties: true,
  },
  MenuItem: {
    type: "object",
    properties: {
      id: idString("menu_item_001"),
      title: { type: "string", example: "Impressum" },
      url: { type: "string", example: "/pages/impressum" },
      resource_type: { type: "string", enum: ["page", "policy", "collection", "product", "custom"], example: "page" },
      resource_id: nullableString,
      position: { type: "integer", example: 1 },
      open_in_new_tab: { type: "boolean", example: false },
      visible: { type: "boolean", example: true },
      handle: nullableString,
      locale: nullableString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MenuItemInput: {
    type: "object",
    description: "Create/update payload for a menu item. Server generated id and timestamps are excluded.",
    required: ["title", "url"],
    properties: {
      title: { type: "string", example: "Impressum" },
      url: { type: "string", example: "/pages/impressum" },
      resource_type: { type: "string", enum: ["page", "policy", "collection", "product", "custom"], example: "page" },
      resource_id: nullableString,
      item_type: { type: "string", example: "page" },
      parent_id: nullableString,
      position: { type: "integer", example: 1 },
      sort_order: { type: "integer", example: 1 },
      open_in_new_tab: { type: "boolean", example: false },
      visible: { type: "boolean", example: true },
      is_active: { type: "boolean", example: true },
      handle: nullableString,
      locale: nullableString,
    },
    additionalProperties: true,
    example: { title: "Impressum", url: "/pages/impressum", resource_type: "page", visible: true },
  },
  Menu: {
    type: "object",
    properties: {
      id: idString("menu_footer"),
      store_id: idString("store_demo"),
      title: { type: "string", example: "Footer" },
      handle: { type: "string", example: "footer" },
      location: { type: "string", example: "footer" },
      items: { type: "array", items: ref("MenuItem") },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MenuInput: {
    type: "object",
    description: "Create/update payload for navigation menus.",
    required: ["title"],
    properties: {
      title: { type: "string", example: "Footer" },
      handle: { type: "string", example: "footer" },
      location: { type: "string", example: "footer" },
      items: { type: "array", items: ref("MenuItemInput") },
    },
    additionalProperties: true,
    example: { title: "Footer", handle: "footer", location: "footer", items: [{ title: "Impressum", url: "/pages/impressum" }] },
  },
  MenuRequest: {
    type: "object",
    properties: {
      menu: ref("MenuInput"),
      item: ref("MenuItemInput"),
      items: { type: "array", items: ref("MenuItemInput") },
    },
    additionalProperties: true,
  },
  MenuResponse: {
    type: "object",
    properties: {
      menu: ref("Menu"),
      data: ref("Menu"),
    },
    additionalProperties: true,
  },
  MenuListResponse: {
    type: "object",
    properties: {
      menus: { type: "array", items: ref("Menu") },
      data: { type: "array", items: ref("Menu") },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  MenuItemRequest: {
    type: "object",
    properties: {
      item: ref("MenuItemInput"),
      menu_item: ref("MenuItemInput"),
    },
    additionalProperties: true,
  },
  MenuItemResponse: {
    type: "object",
    properties: {
      item: ref("MenuItem"),
      menu_item: ref("MenuItem"),
      data: ref("MenuItem"),
    },
    additionalProperties: true,
  },
  Withdrawal: {
    type: "object",
    properties: {
      id: idString("wd_001"),
      store_id: idString("store_demo"),
      order_id: nullableString,
      order_number: nullableString,
      email: { type: "string", format: "email", example: "customer@example.com" },
      customer_name: nullableString,
      reason: nullableString,
      note: nullableString,
      status: { type: "string", enum: ["pending_confirmation", "withdrawal_requested", "confirmed", "cancelled"], example: "withdrawal_requested" },
      confirmed_at: { type: ["string", "null"], format: "date-time" },
      requested_at: dateTimeString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  WithdrawalInput: {
    type: "object",
    description: "Create payload for admin or customer withdrawal requests. Server generated ids, timestamps and status fields are excluded.",
    required: ["email"],
    properties: {
      order_id: nullableString,
      order_number: nullableString,
      email: { type: "string", format: "email", example: "customer@example.com" },
      customer_name: nullableString,
      reason: nullableString,
      note: nullableString,
      postal_code: nullableString,
      idempotency_key: nullableString,
    },
    additionalProperties: true,
    example: { order_number: "1001", email: "customer@example.com", reason: "customer_request", note: "Bitte Widerruf bearbeiten." },
  },
  WithdrawalRequest: {
    type: "object",
    properties: {
      withdrawal: ref("WithdrawalInput"),
      email: { type: "string", format: "email", example: "customer@example.com" },
      reason: nullableString,
      note: nullableString,
    },
    additionalProperties: true,
  },
  WithdrawalResponse: {
    type: "object",
    properties: {
      withdrawal: ref("Withdrawal"),
      email_confirmation: { type: "object", additionalProperties: true },
      confirmation: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  WithdrawalListResponse: {
    type: "object",
    properties: {
      withdrawals: { type: "array", items: ref("Withdrawal") },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  SearchQueryRequest: {
    type: "object",
    required: ["query"],
    properties: {
      resource: { type: "string", enum: ["products", "orders", "customers", "collections", "pages", "articles", "files"], example: "products" },
      query: { type: "string", example: "title:Desk AND status:active" },
      sortKey: { type: "string", example: "UPDATED_AT" },
      reverse: { type: "boolean", example: true },
      limit: { type: "integer", minimum: 1, maximum: 25, example: 10 },
      explain: { type: "boolean", example: true },
    },
    additionalProperties: true,
    example: { resource: "products", query: "title:Desk AND -tag:archived", sortKey: "UPDATED_AT", reverse: true, limit: 10, explain: true },
  },
  SearchQueryResponse: {
    type: "object",
    properties: {
      valid: { type: "boolean", example: true },
      query: { type: "string", example: "title:Desk" },
      resource: { type: "string", example: "products" },
      ast: { type: "object", additionalProperties: true },
      used_filters: { type: "array", items: { type: "object", additionalProperties: true } },
      ignored_fields: { type: "array", items: { type: "string" } },
      invalid_fields: { type: "array", items: { type: "string" } },
      estimated_result_count: { type: "integer", example: 1 },
      sample_results: { type: "array", items: { type: "object", additionalProperties: true } },
      index_usage: { type: "object", additionalProperties: true },
      execution_time_ms: { type: "number", example: 3 },
      errors: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  },
  SavedSearch: {
    type: "object",
    properties: {
      id: idString("saved_products_draft"),
      name: { type: "string", example: "Draft products" },
      resource_type: { type: "string", example: "products" },
      query: { type: "string", example: "status:draft" },
      sort_key: { type: "string", example: "UPDATED_AT" },
      reverse: { type: "boolean", example: true },
      filters: { type: "object", additionalProperties: true },
      owner_user_id: nullableString,
      is_shared: { type: "boolean", example: false },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  SavedSearchInput: {
    type: "object",
    required: ["name", "resource_type"],
    properties: {
      saved_search: { type: "object", additionalProperties: true },
      name: { type: "string", example: "Draft products" },
      resource_type: { type: "string", enum: ["products", "orders", "customers", "collections", "pages", "articles", "files"], example: "products" },
      query: { type: "string", example: "status:draft" },
      sort_key: { type: "string", example: "UPDATED_AT" },
      reverse: { type: "boolean", example: true },
      filters: { type: "object", additionalProperties: true },
      is_shared: { type: "boolean", example: false },
    },
    additionalProperties: true,
  },
  SavedSearchRequest: {
    type: "object",
    properties: {
      saved_search: ref("SavedSearchInput"),
    },
    additionalProperties: true,
  },
  SavedSearchResponse: {
    type: "object",
    properties: {
      saved_search: ref("SavedSearch"),
    },
    additionalProperties: true,
  },
  SavedSearchListResponse: {
    type: "object",
    properties: {
      saved_searches: { type: "array", items: ref("SavedSearch") },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  OnlineStorePreferencesInput: {
    type: "object",
    properties: {
      online_store_preferences: { type: "object", additionalProperties: true },
      password_enabled: { type: "boolean", example: true },
      password: { type: "string", writeOnly: true, example: "write-only-password" },
      password_message: nullableString,
      password_page_title: nullableString,
      password_page_seo_description: nullableString,
      hide_password_page_footer: { type: "boolean", example: false },
      storefront_indexing_enabled: { type: "boolean", example: true },
      robots_txt_mode: { type: "string", enum: ["default", "custom", "blocked"], example: "default" },
      sitemap_enabled: { type: "boolean", example: true },
      favicon_media_id: nullableString,
      social_share_image_media_id: nullableString,
      default_seo_title: nullableString,
      default_seo_description: nullableString,
      maintenance_mode_enabled: { type: "boolean", example: false },
      maintenance_message: nullableString,
    },
    additionalProperties: true,
  },
  OnlineStorePreferencesResponse: {
    type: "object",
    properties: {
      online_store_preferences: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  StorefrontPasswordInput: {
    type: "object",
    properties: {
      password_enabled: { type: "boolean", example: true },
      password: { type: "string", writeOnly: true, example: "write-only-password" },
      password_message: nullableString,
      password_page_title: nullableString,
      password_page_seo_description: nullableString,
      hide_password_page_footer: { type: "boolean", example: false },
    },
    additionalProperties: true,
  },
  StorefrontPasswordResponse: {
    type: "object",
    properties: {
      storefront_password: { type: "object", additionalProperties: true },
      password_configured: { type: "boolean", example: true },
      password_enabled: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  LaunchChecklistRunRequest: {
    type: "object",
    properties: {
      force: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  LaunchChecklistResponse: {
    type: "object",
    properties: {
      launch_checklist: {
        type: "object",
        properties: {
          ready: { type: "boolean", example: true },
          checks: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  PublishingInput: {
    type: "object",
    properties: {
      publication_id: { type: "string", example: "online_store" },
      published_at: { type: ["string", "null"], format: "date-time" },
      schedule_at: { type: ["string", "null"], format: "date-time" },
      reason: nullableString,
    },
    additionalProperties: true,
  },
  PublishingResponse: {
    type: "object",
    properties: {
      publishing: {
        type: "object",
        properties: {
          id: idString("pub_001"),
          resource_type: { type: "string", example: "product" },
          resource_id: idString("prod_001"),
          published_on_current_channel: { type: "boolean", example: true },
          published_channels: { type: "array", items: { type: "string" }, example: ["online_store"] },
          scheduled_publications: { type: "array", items: { type: "object", additionalProperties: true } },
          status: { type: "string", example: "published" },
          published_at: { type: ["string", "null"], format: "date-time" },
          unpublished_at: { type: ["string", "null"], format: "date-time" },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  PublicationsListResponse: {
    type: "object",
    properties: {
      publications: { type: "array", items: { type: "object", additionalProperties: true } },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  CollectionProductPositionInput: {
    type: "object",
    properties: {
      positions: { type: "array", items: { type: "object", properties: { product_id: idString("prod_001"), position: { type: "integer", example: 1 } }, additionalProperties: true } },
      pinned_product_ids: { type: "array", items: { type: "string" } },
      buried_product_ids: { type: "array", items: { type: "string" } },
      sort_rule_id: nullableString,
      reason: nullableString,
    },
    additionalProperties: true,
  },
  CollectionProductPositionRequest: {
    type: "object",
    properties: {
      product_positions: ref("CollectionProductPositionInput"),
      positions: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  },
  CollectionProductPositionResponse: {
    type: "object",
    properties: {
      product_positions: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  CollectionProductPositionListResponse: {
    type: "object",
    properties: {
      product_positions: { type: "array", items: { type: "object", additionalProperties: true } },
      pagination: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  SortRule: {
    type: "object",
    properties: {
      id: idString("sort_rule_margin_boost"),
      name: { type: "string", example: "High margin boost" },
      mode: { type: "string", enum: ["manual", "best_selling", "price_asc", "price_desc", "created_desc", "title_asc", "inventory_desc", "custom_rule"], example: "custom_rule" },
      boosts: { type: "array", items: { type: "object", additionalProperties: true } },
      status: { type: "string", example: "active" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  SortRuleInput: {
    type: "object",
    required: ["name", "mode"],
    properties: {
      name: { type: "string", example: "High margin boost" },
      mode: { type: "string", enum: ["manual", "best_selling", "price_asc", "price_desc", "created_desc", "title_asc", "inventory_desc", "custom_rule"], example: "custom_rule" },
      boosts: { type: "array", items: { type: "object", additionalProperties: true } },
      status: { type: "string", example: "active" },
    },
    additionalProperties: true,
  },
  SortRuleRequest: { type: "object", properties: { sort_rule: ref("SortRuleInput") }, additionalProperties: true },
  SortRuleResponse: { type: "object", properties: { sort_rule: ref("SortRule") }, additionalProperties: true },
  SortRuleListResponse: { type: "object", properties: { sort_rules: { type: "array", items: ref("SortRule") }, pagination: ref("PaginationInfo") }, additionalProperties: true },
  StagedUploadRequest: {
    type: "object",
    properties: {
      filename: { type: "string", example: "hero.png" },
      mime_type: { type: "string", example: "image/png" },
      size: { type: "integer", example: 240000 },
      resource: { type: "string", example: "product_image" },
    },
    additionalProperties: true,
  },
  StagedUploadResponse: {
    type: "object",
    properties: {
      staged_upload: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  FileRecord: {
    type: "object",
    properties: {
      id: idString("file_001"),
      filename: { type: "string", example: "hero.png" },
      url: { type: "string", example: "https://cdn.shopiyz.com/stores/demo/hero.png" },
      mime_type: { type: "string", example: "image/png" },
      status: { type: "string", example: "ready" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  FileCreateInput: {
    type: "object",
    properties: {
      filename: { type: "string", example: "hero.png" },
      src: { type: "string", example: "https://example.com/hero.png" },
      media_asset_id: nullableString,
      alt: nullableString,
      folder_id: nullableString,
      associations: { type: "array", items: { type: "object", additionalProperties: true } },
    },
    additionalProperties: true,
  },
  FileUpdateInput: {
    type: "object",
    properties: {
      filename: { type: "string", example: "hero-updated.png" },
      alt: nullableString,
      folder_id: nullableString,
      status: { type: "string", example: "ready" },
    },
    additionalProperties: true,
  },
  FileRequest: { type: "object", properties: { file: ref("FileCreateInput") }, additionalProperties: true },
  FileResponse: { type: "object", properties: { file: ref("FileRecord") }, additionalProperties: true },
  FileListResponse: { type: "object", properties: { files: { type: "array", items: ref("FileRecord") }, pagination: ref("PaginationInfo") }, additionalProperties: true },
  FileFolder: { type: "object", properties: { id: idString("folder_brand"), name: { type: "string", example: "Brand assets" }, parent_id: nullableString, created_at: dateTimeString, updated_at: dateTimeString }, additionalProperties: true },
  FileFolderInput: { type: "object", properties: { name: { type: "string", example: "Brand assets" }, parent_id: nullableString }, additionalProperties: true },
  FileFolderRequest: { type: "object", properties: { folder: ref("FileFolderInput") }, additionalProperties: true },
  FileFolderResponse: { type: "object", properties: { folder: ref("FileFolder") }, additionalProperties: true },
  FileFolderListResponse: { type: "object", properties: { folders: { type: "array", items: ref("FileFolder") }, pagination: ref("PaginationInfo") }, additionalProperties: true },
  FileRelationRequest: { type: "object", properties: { owner_type: { type: "string", example: "product" }, owner_id: idString("prod_001"), usage_type: { type: "string", example: "product_image" } }, additionalProperties: true },
  DiscountRequest: {
    type: "object",
    properties: {
      discount: {
        type: "object",
        properties: {
          title: { type: "string", example: "Summer desk sale" },
          code: nullableString,
          method: { type: "string", enum: ["code", "automatic"], example: "code" },
          kind: { type: "string", example: "amountOffProducts" },
          value_type: { type: "string", enum: ["percentage", "fixed_amount"], example: "percentage" },
          value: { type: "number", example: 10 },
          starts_at: { type: ["string", "null"], format: "date-time" },
          ends_at: { type: ["string", "null"], format: "date-time" },
          targets: { type: "array", items: { type: "object", additionalProperties: true } },
          conditions: { type: "array", items: { type: "object", additionalProperties: true } },
          enabled: { type: "boolean", example: true },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  DiscountActionRequest: {
    type: "object",
    properties: {
      reason: nullableString,
      preview_id: nullableString,
      dry_run: { type: "boolean", example: true },
      filters: { type: "object", additionalProperties: true },
      targets: { type: "array", items: { type: "object", additionalProperties: true } },
      options: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  DiscountResponse: {
    type: "object",
    properties: {
      discount: { type: "object", additionalProperties: true },
      automatic_discount: { type: "object", additionalProperties: true },
      discount_code: { type: "object", additionalProperties: true },
      job: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  CartRuleRequest: {
    type: "object",
    properties: {
      cart_rule: {
        type: "object",
        properties: {
          title: { type: "string", example: "Minimum order quantity" },
          conditions: { type: "array", items: { type: "object", additionalProperties: true } },
          actions: { type: "array", items: { type: "object", additionalProperties: true } },
          status: { type: "string", enum: ["active", "draft", "archived"], example: "active" },
        },
        additionalProperties: true,
      },
      cart: { type: "object", additionalProperties: true },
      dry_run: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  CartRuleResponse: {
    type: "object",
    properties: {
      cart_rule: { type: "object", additionalProperties: true },
      cart: { type: "object", additionalProperties: true },
      job: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  CheckoutSettingsRequest: {
    type: "object",
    properties: {
      checkout: { type: "object", additionalProperties: true },
      checkout_branding: { type: "object", additionalProperties: true },
      extension: { type: "object", additionalProperties: true },
      validation: { type: "object", additionalProperties: true },
      enabled: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  CheckoutSettingsResponse: {
    type: "object",
    properties: {
      checkout: { type: "object", additionalProperties: true },
      checkout_branding: { type: "object", additionalProperties: true },
      extension: { type: "object", additionalProperties: true },
      validation: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  XmlFeedRequest: {
    type: "object",
    properties: {
      feed: {
        type: "object",
        properties: {
          name: { type: "string", example: "ERP product feed" },
          source_url: { type: ["string", "null"], format: "uri" },
          mapping: { type: "object", additionalProperties: true },
          schedule: { type: "object", additionalProperties: true },
          status: { type: "string", enum: ["active", "paused", "draft"], example: "active" },
        },
        additionalProperties: true,
      },
      dry_run: { type: "boolean", example: true },
      preview_id: nullableString,
    },
    additionalProperties: true,
  },
  XmlFeedResponse: {
    type: "object",
    properties: {
      feed: { type: "object", additionalProperties: true },
      xml_feed: { type: "object", additionalProperties: true },
      job: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  BulkOperation: {
    type: "object",
    properties: {
      id: idString("bulk_001"),
      operation_type: { type: "string", example: "product_export" },
      status: { type: "string", example: "queued" },
      progress_percent: { type: "number", example: 0 },
      object_count: { type: "integer", example: 0 },
      error_count: { type: "integer", example: 0 },
      result_url: nullableString,
      error_url: nullableString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  BulkOperationInput: {
    type: "object",
    required: ["operation_type"],
    properties: {
      operation_type: { type: "string", enum: ["product_import", "product_export", "collection_import", "collection_product_order_update", "metafields_set", "files_import", "price_update", "inventory_update", "translations_import"], example: "product_export" },
      format: { type: "string", enum: ["jsonl", "csv"], example: "jsonl" },
      source_url: nullableString,
      dry_run: { type: "boolean", example: true },
      rollback: { type: "boolean", example: false },
    },
    additionalProperties: true,
  },
  BulkOperationRequest: { type: "object", properties: { bulk_operation: ref("BulkOperationInput") }, additionalProperties: true },
  BulkOperationResponse: { type: "object", properties: { bulk_operation: ref("BulkOperation"), results: { type: "array", items: { type: "object", additionalProperties: true } }, errors: { type: "array", items: { type: "object", additionalProperties: true } } }, additionalProperties: true },
  BulkOperationListResponse: { type: "object", properties: { bulk_operations: { type: "array", items: ref("BulkOperation") }, pagination: ref("PaginationInfo") }, additionalProperties: true },
  WebhookTopicsResponse: { type: "object", properties: { webhook_topics: { type: "array", items: { type: "object", additionalProperties: true } } }, additionalProperties: true },
  WebhookTestDeliveryRequest: { type: "object", properties: { topic: { type: "string", example: "orders/create" }, address: { type: "string", format: "uri", example: "https://example.com/webhook" }, payload: { type: "object", additionalProperties: true } }, additionalProperties: true },
  WebhookDeliveryRetryRequest: { type: "object", properties: { reason: { type: "string", example: "manual_retry" }, force: { type: "boolean", example: false } }, additionalProperties: true },
  WebhookDeliveryResponse: { type: "object", properties: { webhook_delivery: { type: "object", additionalProperties: true }, webhook_test_delivery: { type: "object", additionalProperties: true } }, additionalProperties: true },
  ApiTokenInput: {
    type: "object",
    description: "Create payload for Admin API tokens. The plain token is only returned once by runtime and is never accepted as an input field.",
    required: ["name", "scopes"],
    properties: {
      api_token: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      name: { type: "string", example: "ERP integration" },
      scopes: { type: "array", items: { type: "string" }, example: ["admin:read", "admin:write"] },
      expires_at: { type: ["string", "null"], format: "date-time" },
      status: { type: "string", enum: ["active", "inactive"], example: "active" },
      metadata: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
    example: { name: "ERP integration", scopes: ["admin:read", "admin:write"], expires_at: null },
  },
  StorefrontTokenInput: {
    type: "object",
    description: "Create payload for Storefront API access tokens.",
    required: ["name"],
    properties: {
      token: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      name: { type: "string", example: "Headless storefront" },
      scopes: { type: "array", items: { type: "string" }, example: ["storefront:read"] },
      expires_at: { type: ["string", "null"], format: "date-time" },
      channel: { type: "string", example: "web" },
      metadata: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
    example: { name: "Headless storefront", scopes: ["storefront:read"], channel: "web" },
  },
  UserInput: {
    type: "object",
    description: "Invite or create a staff user. id, created_at and updated_at are server generated.",
    required: ["email"],
    properties: {
      user: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      email: { type: "string", format: "email", example: "staff@example.com" },
      name: { type: "string", example: "Staff User" },
      role_id: nullableString,
      role: nullableString,
      status: { type: "string", enum: ["invited", "active", "disabled"], example: "invited" },
      permissions: { type: "array", items: { type: "string" }, example: ["products.read", "orders.read"] },
      send_invite: { type: "boolean", example: true },
    },
    additionalProperties: true,
    example: { email: "staff@example.com", name: "Staff User", role: "manager", send_invite: true },
  },
  UserUpdateInput: {
    type: "object",
    description: "Patch payload for a staff user.",
    properties: {
      user: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      name: { type: "string", example: "Operations Manager" },
      role_id: nullableString,
      role: nullableString,
      status: { type: "string", enum: ["invited", "active", "disabled"], example: "active" },
      permissions: { type: "array", items: { type: "string" }, example: ["products.read", "orders.read"] },
    },
    additionalProperties: true,
    example: { role: "manager", status: "active" },
  },
  RoleInput: {
    type: "object",
    description: "Create payload for a staff role.",
    required: ["name"],
    properties: {
      role: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      name: { type: "string", example: "Manager" },
      description: nullableString,
      permissions: { type: "array", items: { type: "string" }, example: ["products.read", "orders.read", "settings.read"] },
      is_system: { type: "boolean", example: false },
      status: { type: "string", enum: ["active", "inactive"], example: "active" },
    },
    additionalProperties: true,
    example: { name: "Manager", permissions: ["products.read", "orders.read"] },
  },
  RoleUpdateInput: {
    type: "object",
    description: "Patch payload for a staff role.",
    properties: {
      role: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      name: { type: "string", example: "Operations Manager" },
      description: nullableString,
      permissions: { type: "array", items: { type: "string" } },
      status: { type: "string", enum: ["active", "inactive"], example: "active" },
    },
    additionalProperties: true,
    example: { name: "Operations Manager", permissions: ["products.read", "orders.read", "settings.read"] },
  },
  WebhookInput: {
    type: "object",
    description: "Create payload for webhook subscriptions. Runtime upserts by topic/address when supported.",
    required: ["topic", "address"],
    properties: {
      webhook: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      topic: { type: "string", example: "orders/create" },
      address: { type: "string", format: "uri", example: "https://example.com/webhooks/orders" },
      format: { type: "string", enum: ["json"], example: "json" },
      status: { type: "string", enum: ["active", "paused"], example: "active" },
      fields: { type: "array", items: { type: "string" }, example: ["id", "name", "total_price"] },
      secret: nullableString,
    },
    additionalProperties: true,
    example: { topic: "orders/create", address: "https://example.com/webhooks/orders", format: "json" },
  },
  WebhookUpdateInput: {
    type: "object",
    description: "Patch payload for webhook subscriptions.",
    properties: {
      webhook: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      topic: { type: "string", example: "orders/create" },
      address: { type: "string", format: "uri", example: "https://example.com/webhooks/orders" },
      status: { type: "string", enum: ["active", "paused"], example: "active" },
      fields: { type: "array", items: { type: "string" } },
      secret: nullableString,
    },
    additionalProperties: true,
    example: { status: "active", fields: ["id", "name"] },
  },
  PaymentSettingsInput: {
    type: "object",
    description: "Patch payload for store payment settings.",
    properties: {
      payments: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      enabled: { type: "boolean", example: true },
      test_mode: { type: "boolean", example: false },
      default_provider: nullableString,
      capture_method: { type: "string", enum: ["automatic", "manual"], example: "automatic" },
      currency: { type: "string", example: "EUR" },
      providers: { type: "array", items: ref("PaymentProviderInput") },
    },
    additionalProperties: true,
    example: { enabled: true, test_mode: false, capture_method: "automatic", currency: "EUR" },
  },
  PaymentProviderInput: {
    type: "object",
    description: "Create/update payload for a payment provider setting.",
    required: ["provider"],
    properties: {
      provider_setting: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      provider: { type: "string", example: "stripe" },
      label: { type: "string", example: "Credit card" },
      enabled: { type: "boolean", example: true },
      test_mode: { type: "boolean", example: false },
      credentials: { type: "object", additionalProperties: true, description: "Credential values are secret and may be write-only." },
      config: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
    example: { provider: "stripe", label: "Credit card", enabled: true, test_mode: false },
  },
  CustomerPrivacySettingsInput: {
    type: "object",
    description: "Patch payload for customer privacy, consent and data request settings.",
    properties: {
      customer_privacy: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      cookie_banner_enabled: { type: "boolean", example: true },
      consent_required_regions: { type: "array", items: { type: "string" }, example: ["DE", "EU"] },
      data_request_email: { type: ["string", "null"], format: "email", example: "privacy@example.com" },
      privacy_policy_url: nullableString,
      marketing_opt_in_default: { type: "boolean", example: false },
      retention_days: { type: "integer", example: 730 },
    },
    additionalProperties: true,
    example: { cookie_banner_enabled: true, consent_required_regions: ["DE", "EU"], marketing_opt_in_default: false },
  },
  DomainInput: {
    type: "object",
    description: "Create/update payload for managed domains.",
    required: ["hostname"],
    properties: {
      domain: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      hostname: { type: "string", example: "www.example.com" },
      is_primary: { type: "boolean", example: false },
      provider: nullableString,
      verification_status: { type: "string", enum: ["pending", "verified", "failed"], example: "pending" },
      ssl_status: { type: "string", enum: ["pending", "active", "failed", "renewing"], example: "pending" },
    },
    additionalProperties: true,
    example: { hostname: "www.example.com", is_primary: false },
  },
  DnsRecordInput: {
    type: "object",
    description: "Create/update payload for DNS records attached to a managed domain.",
    required: ["domain_id", "type", "name", "value"],
    properties: {
      dns_record: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      domain_id: idString("domain_001"),
      type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT", "MX"], example: "CNAME" },
      name: { type: "string", example: "www" },
      value: { type: "string", example: "shops.myshopiyz.com" },
      ttl: { type: "integer", example: 300 },
      priority: { type: ["integer", "null"], example: null },
      proxied: { type: "boolean", example: false },
    },
    additionalProperties: true,
    example: { domain_id: "domain_001", type: "CNAME", name: "www", value: "shops.myshopiyz.com", ttl: 300 },
  },
  SslCertificateInput: {
    type: "object",
    description: "Create/renew payload for managed SSL certificates.",
    properties: {
      ssl_certificate: { type: "object", additionalProperties: true, description: "Optional wrapper accepted by runtime clients." },
      domain_id: idString("domain_001"),
      hostname: { type: "string", example: "www.example.com" },
      provider: { type: "string", example: "cloudflare" },
      status: { type: "string", enum: ["pending_validation", "renewing"], example: "pending_validation" },
    },
    additionalProperties: true,
    example: { domain_id: "domain_001", provider: "cloudflare" },
  },
  ProductVariant: {
    type: "object",
    properties: {
      id: idString("var_001"),
      productId: idString("prod_ergonomic_desk"),
      title: nullableString,
      sku: nullableString,
      barcode: nullableString,
      price: moneyNumber,
      compareAtPrice: { type: ["number", "null"], example: 1499 },
      cost: { type: ["number", "null"], example: 899 },
      inventoryQuantity: { type: "integer", example: 10 },
      inventoryPolicy: { type: "string", enum: ["deny", "continue"], example: "deny" },
      trackInventory: { type: "boolean", example: true },
      taxable: { type: "boolean", example: true },
      requiresShipping: { type: "boolean", example: true },
      weight: { type: "number", example: 12.5 },
      weightUnit: { type: "string", example: "kg" },
      imageUrl: nullableString,
      position: { type: "integer", example: 1 },
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
    },
    additionalProperties: true,
  },
  ProductImage: {
    type: "object",
    properties: {
      id: idString("img_001"),
      productId: idString("prod_ergonomic_desk"),
      url: { type: "string", format: "uri", example: "https://cdn.shopiyz.com/demo/desk.jpg" },
      altText: nullableString,
      mediaType: { type: "string", example: "image" },
      position: { type: "integer", example: 1 },
      isFeatured: { type: "boolean", example: true },
      width: { type: ["integer", "null"], example: 1200 },
      height: { type: ["integer", "null"], example: 800 },
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
    },
    additionalProperties: true,
  },
  Product: {
    type: "object",
    required: ["id", "title", "handle", "status"],
    properties: {
      id: idString("prod_ergonomic_desk"),
      storeId: idString("store_demo"),
      title: { type: "string", example: "Ergonomic Desk" },
      handle: { type: "string", example: "ergonomic-desk" },
      slug: { type: "string", example: "ergonomic-desk" },
      status: { type: "string", enum: ["draft", "active", "unlisted", "archived"], example: "active" },
      vendor: nullableString,
      productType: nullableString,
      productCategory: nullableString,
      description: nullableString,
      seoTitle: nullableString,
      seoDescription: nullableString,
      tags: { type: "array", items: { type: "string" } },
      featuredImageUrl: nullableString,
      trackInventory: { type: "boolean", example: true },
      continueSellingWhenOutOfStock: { type: "boolean", example: false },
      requiresShipping: { type: "boolean", example: true },
      variantCount: { type: "integer", example: 1 },
      inventoryQuantity: { type: "integer", example: 10 },
      minPrice: moneyNumber,
      maxPrice: moneyNumber,
      variants: { type: "array", items: ref("ProductVariant") },
      images: { type: "array", items: ref("ProductImage") },
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
    },
    additionalProperties: true,
  },
  ProductCreateRequest: {
    type: "object",
    required: ["product"],
    properties: {
      product: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string", example: "Ergonomic Desk" },
          handle: { type: "string", example: "ergonomic-desk" },
          status: { type: "string", enum: ["draft", "active", "unlisted", "archived"], example: "draft" },
          vendor: { type: "string", example: "Shopiyz Demo" },
          description: { type: "string", example: "Height-adjustable desk for home office." },
          tags: { type: "array", items: { type: "string" }, example: ["office", "desk"] },
          variants: { type: "array", items: { type: "object", additionalProperties: true } },
          images: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        additionalProperties: true,
      },
    },
  },
  ProductUpdateRequest: {
    type: "object",
    required: ["product"],
    properties: {
      product: {
        type: "object",
        properties: {
          title: { type: "string", example: "Ergonomic Desk Pro" },
          status: { type: "string", enum: ["draft", "active", "unlisted", "archived"], example: "active" },
          vendor: { type: "string", example: "Shopiyz Demo" },
          tags: { type: "array", items: { type: "string" } },
        },
        additionalProperties: true,
      },
    },
  },
  ProductResponse: { type: "object", properties: { product: ref("Product") }, additionalProperties: true },
  ProductListResponse: {
    type: "object",
    properties: { products: { type: "array", items: ref("Product") }, meta: ref("PaginationInfo") },
    additionalProperties: true,
  },
  ProductVariantResponse: { type: "object", properties: { variant: ref("ProductVariant"), variants: { type: "array", items: ref("ProductVariant") } }, additionalProperties: true },
  ProductImageResponse: { type: "object", properties: { image: ref("ProductImage"), images: { type: "array", items: ref("ProductImage") } }, additionalProperties: true },
  CollectionImage: {
    type: "object",
    properties: {
      src: { type: ["string", "null"], format: "uri", example: "https://cdn.shopiyz.com/demo/office.jpg" },
      url: { type: ["string", "null"], format: "uri", example: "https://cdn.shopiyz.com/demo/office.jpg" },
      alt: nullableString,
      width: { type: ["integer", "null"], example: 1200 },
      height: { type: ["integer", "null"], example: 800 },
    },
    additionalProperties: true,
  },
  CollectionInput: {
    type: "object",
    properties: {
      title: { type: "string", example: "Office" },
      handle: { type: "string", example: "office" },
      body_html: { type: ["string", "null"], example: "Office products and accessories." },
      description: { type: ["string", "null"], example: "Office products and accessories." },
      status: { type: "string", enum: ["draft", "active", "archived"], example: "active" },
      published: { type: "boolean", example: true },
      published_at: dateTimeString,
      sort_order: { type: "string", example: "manual" },
      image: ref("CollectionImage"),
      image_url: { type: ["string", "null"], format: "uri" },
      image_alt: nullableString,
      image_alt_text: nullableString,
      image_width: { type: ["integer", "null"], example: 1200 },
      image_height: { type: ["integer", "null"], example: 800 },
      seo_title: nullableString,
      seo_description: nullableString,
      metafields_global_title_tag: nullableString,
      metafields_global_description_tag: nullableString,
      search_preview_title: nullableString,
      search_preview_description: nullableString,
      template_suffix: nullableString,
      rules: { type: "array", items: { type: "object", additionalProperties: true } },
      disjunctive: { type: "boolean", example: false },
      product_ids: { type: "array", items: { type: "string" } },
      productIds: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  },
  Collection: {
    type: "object",
    properties: {
      id: idString("col_001"),
      title: { type: "string", example: "Office" },
      handle: { type: "string", example: "office" },
      slug: { type: "string", example: "office" },
      body_html: nullableString,
      description: nullableString,
      type: { type: "string", enum: ["manual", "automated"], example: "manual" },
      status: { type: "string", enum: ["draft", "active", "archived"], example: "active" },
      published: { type: "boolean", example: true },
      published_at: dateTimeString,
      productIds: { type: "array", items: { type: "string" } },
      product_ids: { type: "array", items: { type: "string" } },
      productCount: { type: "integer", example: 12 },
      products_count: { type: "integer", example: 12 },
      sortOrder: { type: "string", example: "manual" },
      sort_order: { type: "string", example: "manual" },
      rules: { type: ["object", "null"], additionalProperties: true },
      image: ref("CollectionImage"),
      image_url: { type: ["string", "null"], format: "uri" },
      imageAlt: nullableString,
      imageAltText: nullableString,
      image_alt: nullableString,
      image_alt_text: nullableString,
      imageWidth: { type: ["integer", "null"], example: 1200 },
      imageHeight: { type: ["integer", "null"], example: 800 },
      image_width: { type: ["integer", "null"], example: 1200 },
      image_height: { type: ["integer", "null"], example: 800 },
      seoTitle: nullableString,
      seoDescription: nullableString,
      seo_title: nullableString,
      seo_description: nullableString,
      metafields_global_title_tag: nullableString,
      metafields_global_description_tag: nullableString,
      searchPreviewTitle: nullableString,
      searchPreviewDescription: nullableString,
      search_preview_title: nullableString,
      search_preview_description: nullableString,
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  CollectionRequest: {
    type: "object",
    properties: {
      collection: ref("CollectionInput"),
      custom_collection: ref("CollectionInput"),
      smart_collection: ref("CollectionInput"),
      category: ref("CollectionInput"),
    },
    additionalProperties: true,
  },
  CollectionResponse: {
    type: "object",
    properties: {
      collection: ref("Collection"),
      custom_collection: ref("Collection"),
      smart_collection: ref("Collection"),
      category: ref("Collection"),
    },
    additionalProperties: true,
  },
  CollectionListResponse: {
    type: "object",
    properties: {
      collections: { type: "array", items: ref("Collection") },
      custom_collections: { type: "array", items: ref("Collection") },
      smart_collections: { type: "array", items: ref("Collection") },
      categories: { type: "array", items: ref("Collection") },
      meta: ref("PaginationInfo"),
    },
    additionalProperties: true,
  },
  MediaAsset: {
    type: "object",
    properties: {
      id: idString("med_001"),
      url: { type: "string", format: "uri", example: "https://cdn.shopiyz.com/demo/office.jpg" },
      src: { type: "string", format: "uri", example: "https://cdn.shopiyz.com/demo/office.jpg" },
      file_url: { type: "string", format: "uri", example: "https://cdn.shopiyz.com/demo/office.jpg" },
      file_name: nullableString,
      alt: nullableString,
      alt_text: nullableString,
      width: { type: ["integer", "null"], example: 1200 },
      height: { type: ["integer", "null"], example: 800 },
      mime_type: { type: ["string", "null"], example: "image/jpeg" },
      size: { type: ["integer", "null"], example: 182044 },
      tags: { type: ["string", "null"], example: "[\"collection-cover\"]" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MediaAssetInput: {
    type: "object",
    properties: {
      file_url: { type: ["string", "null"], format: "uri", example: "https://cdn.example.com/office.jpg" },
      url: { type: ["string", "null"], format: "uri" },
      src: { type: ["string", "null"], format: "uri" },
      base64: { type: "string", description: "Base64 or data URL encoded upload body." },
      data_url: { type: "string", example: "data:image/png;base64,iVBORw0KGgo..." },
      file_name: { type: "string", example: "office.jpg" },
      name: { type: "string", example: "office.jpg" },
      mime_type: { type: "string", example: "image/jpeg" },
      alt: nullableString,
      alt_text: nullableString,
      width: { type: ["integer", "null"], example: 1200 },
      height: { type: ["integer", "null"], example: 800 },
      tags: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  },
  MediaAssetRequest: {
    type: "object",
    properties: {
      media_asset: ref("MediaAssetInput"),
    },
    additionalProperties: true,
  },
  MediaAssetMultipartRequest: {
    type: "object",
    properties: {
      file: { type: "string", format: "binary" },
      file_url: { type: "string", format: "uri" },
      file_name: { type: "string", example: "office.jpg" },
      mime_type: { type: "string", example: "image/jpeg" },
      alt: nullableString,
      alt_text: nullableString,
      width: { type: "integer", example: 1200 },
      height: { type: "integer", example: 800 },
      tags: { type: "string", example: "collection-cover,hero" },
    },
    additionalProperties: true,
  },
  MediaAssetResponse: { type: "object", properties: { media_asset: ref("MediaAsset") }, additionalProperties: true },
  MediaAssetListResponse: { type: "object", properties: { media_assets: { type: "array", items: ref("MediaAsset") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  MediaAltTextSuggestionRequest: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["preview", "apply"], example: "preview" },
      locale: { type: "string", example: "de" },
      context: { type: "string", example: "collection cover image for standing desks" },
      overwrite_existing: { type: "boolean", example: false },
    },
    additionalProperties: true,
    example: { mode: "preview", locale: "de", overwrite_existing: false },
  },
  MediaAltTextSuggestionResponse: {
    type: "object",
    properties: {
      alt_text_suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            asset_id: idString("media_img_001"),
            alt: { type: "string", example: "Height-adjustable desk in a bright office" },
            confidence: { type: "number", example: 0.84 },
            source: { type: "string", example: "ai_suggestion" },
          },
          additionalProperties: true,
        },
      },
      media_asset: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
  },
  MediaTransformRequest: {
    type: "object",
    properties: {
      transform: {
        type: "object",
        properties: {
          resize: { type: "object", additionalProperties: true, example: { width: 1200, height: 800, fit: "cover" } },
          crop: { type: "object", additionalProperties: true, example: { x: 0, y: 0, width: 1200, height: 800 } },
          format: { type: "string", enum: ["jpg", "png", "webp", "avif"], example: "webp" },
          quality: { type: "integer", minimum: 1, maximum: 100, example: 82 },
        },
        additionalProperties: true,
      },
      preview: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  MediaTransformResponse: {
    type: "object",
    properties: {
      transform: { type: "object", additionalProperties: true },
      media_asset: ref("MediaAsset"),
    },
    additionalProperties: true,
  },
  MediaBulkActionRequest: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["update_alt_text", "attach", "detach", "replace_folder", "delete"], example: "update_alt_text" },
      ids: { type: "array", items: { type: "string" }, example: ["media_img_001"] },
      alt: nullableString,
      owner_type: nullableString,
      owner_id: nullableString,
      dry_run: { type: "boolean", example: true },
      preview_id: nullableString,
    },
    additionalProperties: true,
  },
  MediaExportRequest: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["jsonl", "csv", "zip"], example: "jsonl" },
      filters: { type: "object", additionalProperties: true },
      include_binary: { type: "boolean", example: false },
      fields: { type: "array", items: { type: "string" }, example: ["id", "url", "alt", "mime_type"] },
    },
    additionalProperties: true,
  },
  MediaImportRequest: {
    type: "object",
    properties: {
      source_url: { type: ["string", "null"], format: "uri", example: "https://example.com/media-export.jsonl" },
      assets: { type: "array", items: ref("MediaAssetInput") },
      mode: { type: "string", enum: ["create", "upsert"], example: "upsert" },
      dry_run: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  MediaOptimizeRequest: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" }, example: ["media_img_001"] },
      preset: { type: "string", enum: ["web", "storefront", "thumbnail"], example: "storefront" },
      formats: { type: "array", items: { type: "string" }, example: ["webp", "avif"] },
      quality: { type: "integer", minimum: 1, maximum: 100, example: 82 },
      dry_run: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  ThemeFile: {
    type: "object",
    properties: {
      id: idString("theme_file_001"),
      key: { type: "string", example: "assets/favicon.svg" },
      theme_id: idString("theme_001"),
      content_type: { type: "string", example: "image/svg+xml" },
      size: { type: "integer", example: 1234 },
      checksum: { type: "string", example: "8f14e45fceea167a5a36dedd4bea2543" },
      public_url: { type: ["string", "null"], format: "uri", example: "https://cdn.shopiyz.com/stores/demo/theme-files/favicon.svg" },
      url: { type: ["string", "null"], format: "uri" },
      src: { type: ["string", "null"], format: "uri" },
      value: { type: ["string", "null"], description: "Text content for text theme files. Binary files do not echo base64 attachments." },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  ThemeFileUpsertInput: {
    type: "object",
    properties: {
      key: { type: "string", example: "sections/footer.json" },
      value: { type: "string", description: "Text content for JSON, Liquid, CSS, JS, locale and section/template files." },
      attachment: { type: "string", description: "Base64 or data URL content for binary theme assets." },
      content_type: { type: "string", example: "application/json" },
    },
    additionalProperties: true,
  },
  ThemeFileUpsertRequest: {
    type: "object",
    properties: {
      file: ref("ThemeFileUpsertInput"),
      preview_confirmed: { type: "boolean", description: "Required for non-asset template/section updates." },
    },
    additionalProperties: true,
  },
  ThemeFileResponse: { type: "object", properties: { file: ref("ThemeFile"), theme_file: ref("ThemeFile"), action: { type: "string", example: "updated" } }, additionalProperties: true },
  ThemeFileListResponse: { type: "object", properties: { files: { type: "array", items: ref("ThemeFile") }, page_info: { type: ["string", "null"] } }, additionalProperties: true },
  ThemeFileDeleteResponse: {
    type: "object",
    properties: {
      deleted: { type: "boolean", example: true },
      key: { type: "string", example: "assets/favicon.svg" },
      rollback_revision_stored: { type: "boolean", example: true },
      asset_retained_for_rollback: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  Customer: {
    type: "object",
    properties: {
      id: idString("cus_001"),
      email: { type: "string", format: "email", example: "customer@example.com" },
      firstName: nullableString,
      lastName: nullableString,
      phone: nullableString,
      country: nullableString,
      tags: { type: "array", items: { type: "string" } },
      acceptsMarketingEmail: { type: "boolean", example: true },
      ordersCount: { type: "integer", example: 2 },
      totalSpent: moneyNumber,
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
    },
    additionalProperties: true,
  },
  CustomerListResponse: { type: "object", properties: { customers: { type: "array", items: ref("Customer") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  OrderLineItem: {
    type: "object",
    properties: {
      id: idString("line_1"),
      productId: nullableString,
      variantId: nullableString,
      title: { type: "string", example: "Ergonomic Desk" },
      sku: nullableString,
      quantity: { type: "integer", example: 1 },
      fulfilledQuantity: { type: "integer", example: 0 },
      unitPrice: moneyNumber,
      totalPrice: moneyNumber,
      requiresShipping: { type: "boolean", example: true },
    },
    additionalProperties: true,
  },
  Order: {
    type: "object",
    properties: {
      id: idString("ord_1001"),
      name: { type: "string", example: "#1001" },
      customerId: nullableString,
      email: { type: ["string", "null"], format: "email" },
      status: { type: "string", example: "open" },
      financialStatus: { type: "string", example: "paid" },
      fulfillmentStatus: { type: "string", example: "unfulfilled" },
      currency: { type: "string", example: "TRY" },
      subtotalPrice: moneyNumber,
      totalPrice: moneyNumber,
      lineItems: { type: "array", items: ref("OrderLineItem") },
      createdAt: dateTimeString,
      updatedAt: dateTimeString,
    },
    additionalProperties: true,
  },
  OrderResponse: { type: "object", properties: { order: ref("Order") }, additionalProperties: true },
  OrderListResponse: { type: "object", properties: { orders: { type: "array", items: ref("Order") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  OrderUpdateRequest: {
    type: "object",
    properties: {
      order: {
        type: "object",
        properties: {
          status: { type: "string", example: "open" },
          financial_status: { type: "string", example: "paid" },
          fulfillment_status: { type: "string", example: "unfulfilled" },
          note: nullableString,
          tags: { type: "array", items: { type: "string" }, example: ["vip", "manual-review"] },
        },
        additionalProperties: true,
      },
      reason: nullableString,
      preview_id: nullableString,
    },
    additionalProperties: true,
    example: { order: { note: "Reviewed by support", tags: ["vip"] }, reason: "support_update" },
  },
  OrderArchiveInput: {
    type: "object",
    properties: {
      reason: { type: "string", example: "completed_workflow" },
      notify_customer: { type: "boolean", example: false },
      preview_id: nullableString,
    },
    additionalProperties: true,
    example: { reason: "completed_workflow", notify_customer: false },
  },
  OrderActionRequest: {
    type: "object",
    properties: {
      action: { type: "string", example: "hold_fulfillment" },
      reason: nullableString,
      note: nullableString,
      notify_customer: { type: "boolean", example: false },
      preview_id: nullableString,
      metadata: { type: "object", additionalProperties: true },
    },
    additionalProperties: true,
    example: { action: "hold_fulfillment", reason: "risk_review", notify_customer: false },
  },
  OrderNoteInput: {
    type: "object",
    properties: {
      note: {
        type: "object",
        properties: {
          body: { type: "string", example: "Customer requested delivery after Friday." },
          visibility: { type: "string", enum: ["admin", "customer", "fulfillment"], example: "admin" },
          pinned: { type: "boolean", example: false },
        },
        additionalProperties: true,
      },
      body: { type: "string", example: "Customer requested delivery after Friday." },
      visibility: { type: "string", enum: ["admin", "customer", "fulfillment"], example: "admin" },
    },
    additionalProperties: true,
  },
  OrderTagInput: {
    type: "object",
    properties: {
      tags: { type: "array", items: { type: "string" }, example: ["vip", "priority"] },
      tag: { type: "string", example: "vip" },
      mode: { type: "string", enum: ["add", "remove", "replace"], example: "add" },
    },
    additionalProperties: true,
    example: { tags: ["vip"], mode: "add" },
  },
  OrderRiskInput: {
    type: "object",
    properties: {
      risk: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["low", "medium", "high"], example: "medium" },
          score: { type: "number", example: 0.62 },
          recommendation: { type: "string", enum: ["accept", "review", "cancel"], example: "review" },
          message: nullableString,
        },
        additionalProperties: true,
      },
      level: { type: "string", enum: ["low", "medium", "high"], example: "medium" },
      recommendation: { type: "string", enum: ["accept", "review", "cancel"], example: "review" },
    },
    additionalProperties: true,
  },
  OrderActionPreviewResponse: {
    type: "object",
    properties: {
      order_action: { type: "object", additionalProperties: true },
      preview: { type: "object", additionalProperties: true },
      preview_id: nullableString,
      requires_approval: { type: "boolean", example: true },
      warnings: { type: "array", items: { type: "string" } },
    },
    additionalProperties: true,
  },
  OrderCancelPreviewRequest: {
    type: "object",
    properties: { reason: { type: "string", example: "customer" }, restock: { type: "boolean", example: true }, notifyCustomer: { type: "boolean", example: false } },
    additionalProperties: true,
  },
  OrderCancelRequest: {
    type: "object",
    properties: { reason: { type: "string", example: "customer" }, restock: { type: "boolean", example: true }, notifyCustomer: { type: "boolean", example: false }, previewId: idString("preview_cancel_1001") },
    additionalProperties: true,
  },
  Metafield: {
    type: "object",
    properties: {
      id: idString("product:prod_ergonomic_desk:specs.material"),
      owner_type: { type: "string", example: "product" },
      owner_id: idString("prod_ergonomic_desk"),
      namespace: { type: "string", example: "specs" },
      key: { type: "string", example: "material" },
      value: { type: "string", example: "steel" },
      type: { type: "string", example: "single_line_text_field" },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MetafieldRequest: {
    type: "object",
    properties: {
      metafield: {
        type: "object",
        required: ["owner_type", "owner_id", "namespace", "key", "value"],
        properties: {
          owner_type: { type: "string", example: "product" },
          owner_id: idString("prod_ergonomic_desk"),
          namespace: { type: "string", example: "specs" },
          key: { type: "string", example: "material" },
          value: { example: "steel" },
          type: { type: "string", example: "single_line_text_field" },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  MetafieldResponse: { type: "object", properties: { metafield: ref("Metafield") }, additionalProperties: true },
  MetafieldListResponse: { type: "object", properties: { metafields: { type: "array", items: ref("Metafield") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  MetafieldDefinition: {
    type: "object",
    properties: {
      id: idString("mfd_material"),
      owner_type: { type: "string", example: "product" },
      namespace: { type: "string", example: "specs" },
      key: { type: "string", example: "material" },
      name: { type: "string", example: "Material" },
      description: nullableString,
      type: { type: "string", example: "single_line_text_field" },
      validations: { type: "array", items: { type: "object", additionalProperties: true } },
      default_value: nullableString,
      is_pinned: { type: "boolean", example: true },
      is_active: { type: "boolean", example: true },
      visible_to_storefront: { type: "boolean", example: true },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MetafieldDefinitionRequest: {
    type: "object",
    properties: {
      definition: {
        type: "object",
        required: ["owner_type", "namespace", "key", "name", "type"],
        properties: {
          owner_type: { type: "string", example: "product" },
          namespace: { type: "string", example: "specs" },
          key: { type: "string", example: "material" },
          name: { type: "string", example: "Material" },
          description: nullableString,
          type: { type: "string", example: "single_line_text_field" },
          validations: { type: "array", items: { type: "object", additionalProperties: true } },
          default_value: nullableString,
          is_pinned: { type: "boolean", example: true },
          is_active: { type: "boolean", example: true },
          visible_to_storefront: { type: "boolean", example: true },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  MetafieldDefinitionResponse: { type: "object", properties: { metafield_definition: ref("MetafieldDefinition"), definition: ref("MetafieldDefinition") }, additionalProperties: true },
  MetafieldDefinitionListResponse: { type: "object", properties: { metafield_definitions: { type: "array", items: ref("MetafieldDefinition") }, definitions: { type: "array", items: ref("MetafieldDefinition") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  MetaobjectFieldDefinition: {
    type: "object",
    properties: {
      id: idString("field_title"),
      name: { type: "string", example: "Title" },
      key: { type: "string", example: "title" },
      type: { type: "string", example: "single_line_text_field" },
      required: { type: "boolean", example: true },
      useAsDisplayName: { type: "boolean", example: true },
      filterable: { type: "boolean", example: false },
      position: { type: "integer", example: 0 },
    },
    additionalProperties: true,
  },
  MetaobjectDefinition: {
    type: "object",
    properties: {
      id: idString("mod_size_guide"),
      type: { type: "string", example: "size_guide" },
      name: { type: "string", example: "Size guide" },
      description: nullableString,
      fields: { type: "array", items: ref("MetaobjectFieldDefinition") },
      options: { type: "object", additionalProperties: true },
      entry_count: { type: "integer", example: 3 },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MetaobjectDefinitionRequest: {
    type: "object",
    properties: {
      definition: {
        type: "object",
        required: ["type", "name", "fields"],
        properties: {
          type: { type: "string", example: "size_guide" },
          name: { type: "string", example: "Size guide" },
          description: nullableString,
          fields: { type: "array", items: ref("MetaobjectFieldDefinition") },
          options: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  MetaobjectDefinitionResponse: { type: "object", properties: { metaobject_definition: ref("MetaobjectDefinition"), definition: ref("MetaobjectDefinition") }, additionalProperties: true },
  MetaobjectDefinitionListResponse: { type: "object", properties: { metaobject_definitions: { type: "array", items: ref("MetaobjectDefinition") }, definitions: { type: "array", items: ref("MetaobjectDefinition") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  MetaobjectEntry: {
    type: "object",
    properties: {
      id: idString("mo_desk_size_guide"),
      definition_id: idString("mod_size_guide"),
      type: { type: "string", example: "size_guide" },
      handle: { type: "string", example: "desk-size-guide" },
      display_name: { type: "string", example: "Desk size guide" },
      status: { type: "string", example: "active" },
      fields: { type: "object", additionalProperties: true },
      created_at: dateTimeString,
      updated_at: dateTimeString,
    },
    additionalProperties: true,
  },
  MetaobjectEntryRequest: {
    type: "object",
    properties: {
      metaobject: {
        type: "object",
        properties: {
          definition_id: idString("mod_size_guide"),
          type: { type: "string", example: "size_guide" },
          handle: { type: "string", example: "desk-size-guide" },
          status: { type: "string", example: "active" },
          fields: { type: "object", additionalProperties: true, example: { title: "Desk size guide" } },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  MetaobjectEntryResponse: { type: "object", properties: { metaobject: ref("MetaobjectEntry"), entry: ref("MetaobjectEntry") }, additionalProperties: true },
  MetaobjectEntryListResponse: { type: "object", properties: { metaobjects: { type: "array", items: ref("MetaobjectEntry") }, entries: { type: "array", items: ref("MetaobjectEntry") }, meta: ref("PaginationInfo") }, additionalProperties: true },
  CustomDataSummaryResponse: {
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          metafield_definitions: { type: "integer", example: 3 },
          metafield_values: { type: "integer", example: 12 },
          pinned_metafields: { type: "integer", example: 1 },
          metaobject_definitions: { type: "integer", example: 2 },
          metaobject_entries: { type: "integer", example: 8 },
          storefront_visible: { type: "integer", example: 2 },
        },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
  App: {
    type: "object",
    properties: { id: idString("app_product_faq"), handle: { type: "string", example: "product-faq-studio" }, name: { type: "string", example: "Product FAQ Studio" }, status: { type: "string", example: "enabled" } },
    additionalProperties: true,
  },
  AppSettings: { type: "object", additionalProperties: true },
  AppListResponse: { type: "object", properties: { apps: { type: "array", items: ref("App") } }, additionalProperties: true },
  ProductFaq: {
    type: "object",
    properties: { id: idString("faq_shipping"), question: { type: "string", example: "Kargo süresi nedir?" }, answer: { type: "string", example: "Genellikle 1-3 iş günü." }, status: { type: "string", enum: ["published", "draft"], example: "published" }, group: { type: "string", example: "Kargo" }, sortOrder: { type: "integer", example: 10 } },
    additionalProperties: true,
  },
  ProductFaqCreateRequest: { type: "object", properties: { faq: ref("ProductFaq") }, additionalProperties: true },
  ProductFaqResponse: { type: "object", properties: { faq: ref("ProductFaq") }, additionalProperties: true },
  ProductFaqListResponse: { type: "object", properties: { faqs: { type: "array", items: ref("ProductFaq") } }, additionalProperties: true },
  ProductTab: {
    type: "object",
    properties: { id: idString("tab_shipping"), label: { type: "string", example: "Kargo" }, source: { type: "string", example: "static_content" }, enabled: { type: "boolean", example: true }, sortOrder: { type: "integer", example: 10 }, content: { type: "string", example: "1-3 iş günü içinde gönderilir." } },
    additionalProperties: true,
  },
  ProductTabCreateRequest: { type: "object", properties: { tab: ref("ProductTab") }, additionalProperties: true },
  ProductTabResponse: { type: "object", properties: { tab: ref("ProductTab") }, additionalProperties: true },
  ProductTabListResponse: { type: "object", properties: { tabs: { type: "array", items: ref("ProductTab") } }, additionalProperties: true },
  BulkActionRequest: {
    type: "object",
    properties: { ids: { type: "array", items: { type: "string" } }, action: { type: "string", example: "archive" }, previewId: nullableString },
    additionalProperties: true,
  },
  BulkActionResponse: {
    type: "object",
    properties: { job: ref("JobStatusResponse"), result: { type: "object", additionalProperties: true } },
    additionalProperties: true,
  },
  JobStatusResponse: {
    type: "object",
    properties: { job: { type: "object", properties: { id: idString("job_001"), status: { type: "string", example: "queued" }, progress: { type: "number", example: 0 } }, additionalProperties: true } },
    additionalProperties: true,
  },
  PreviewResponse: {
    type: "object",
    properties: { previewId: idString("preview_001"), requiresApproval: { type: "boolean", example: true }, impact: { type: "object", additionalProperties: true }, warnings: { type: "array", items: { type: "string" } } },
    additionalProperties: true,
  },
  ApprovalRequiredResponse: {
    type: "object",
    properties: { approvalRequired: { type: "boolean", example: true }, previewId: idString("preview_001"), confirmation: { type: "string", example: "typed" }, stepUp: { type: "string", example: "mfa" } },
    additionalProperties: true,
  },
};

const OPENAPI_ERROR_RESPONSES = {
  BadRequest: { description: "Bad request.", content: { "application/json": { schema: ref("AdminApiError") } } },
  Unauthorized: { description: "Authentication token is missing or invalid.", content: { "application/json": { schema: ref("AdminApiError") } } },
  Forbidden: { description: "The token does not have the required scope or role.", content: { "application/json": { schema: ref("AdminApiError") } } },
  NotFound: { description: "The requested resource was not found.", content: { "application/json": { schema: ref("AdminApiError") } } },
  Conflict: { description: "The request conflicts with the current resource state.", content: { "application/json": { schema: ref("AdminApiError") } } },
  UnprocessableEntity: { description: "Validation failed.", content: { "application/json": { schema: ref("ValidationError") } } },
  TooManyRequests: {
    description: "Rate limit exceeded. Wait for Retry-After before retrying.",
    headers: Object.fromEntries(rateLimit429HeaderRefs.map(([name, component]) => [name, headerRef(component)])),
    content: { "application/json": { schema: ref("RateLimitError") } },
  },
  InternalServerError: { description: "Unexpected server error.", content: { "application/json": { schema: ref("AdminApiError") } } },
};

const operationErrorResponseRefs = [
  ["400", "#/components/responses/BadRequest"],
  ["401", "#/components/responses/Unauthorized"],
  ["403", "#/components/responses/Forbidden"],
  ["404", "#/components/responses/NotFound"],
  ["409", "#/components/responses/Conflict"],
  ["422", "#/components/responses/UnprocessableEntity"],
  ["429", "#/components/responses/TooManyRequests"],
  ["500", "#/components/responses/InternalServerError"],
];

function requiredScopesFor(operation) {
  if (Array.isArray(operation.requiredScopes) && operation.requiredScopes.length) return operation.requiredScopes;
  return operation.method === "GET" ? ["admin:read", "admin:write"] : ["admin:write"];
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
  const aiSafety = operation.aiSafety || {
    safe: operation.method === "GET" && operation.risk === "R0",
    readOnly: operation.method === "GET" || operation.operationKind === "read" || operation.operationKind === "audit",
    requiresConfirmation: operation.method !== "GET" && operation.confirmation !== "none",
    destructive: operation.method === "DELETE" || operation.risk === "R5",
    idempotencyRequired: Boolean(operation.idempotencyRequired),
    humanSummary: operation.description || operation.summary || operation.action || operation.operationId,
    beforeCall: operation.method === "GET" ? ["Validate store context and required read scope."] : ["Confirm the target resource and required scope before calling."],
  };
  const throttlePolicy = operation.throttlePolicy || {
    algorithm: "leaky_bucket",
    tier: "standard",
    group: operation.rateLimitGroup || "admin_api_global",
    scope: operation.rateLimitScope || "store_token",
    cost: Number(operation.rateLimitCost || 1),
    bucketSize: 40,
    restoreRatePerSecond: 2,
    retryAfterHeader: "Retry-After",
    headers: [
      "X-Shopiyz-Api-Call-Limit",
      "X-Shopiyz-Api-Bucket-Size",
      "X-Shopiyz-Api-Restore-Rate",
      "X-Shopiyz-Api-Cost",
      "X-Shopiyz-RateLimit-Remaining",
      "X-Request-Id",
    ],
    description: operation.rateLimitDescription || "Leaky bucket throttle scoped by store + API token/app.",
  };
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
    requiredScopes: requiredScopesFor(operation),
    implemented: operation.implemented !== false,
    idempotencyRequired: Boolean(operation.idempotencyRequired),
    previewRequired: Boolean(operation.previewRequired),
    rollbackSupported: Boolean(operation.rollbackSupported),
    parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
    requestSchemaRef: operation.requestSchemaRef || null,
    responseSchemaRef: operation.responseSchemaRef || "#/components/schemas/AdminApiResponse",
    examples: operation.examples || undefined,
    errorCodes: Array.isArray(operation.errorCodes) ? operation.errorCodes : ["400", "401", "403", "404", "409", "422", "429", "500"],
    requiredHeaders: Array.isArray(operation.requiredHeaders) ? operation.requiredHeaders : [],
    aiSafety,
    rateLimitGroup: operation.rateLimitGroup || throttlePolicy.group || "admin_api_global",
    rateLimitCost: Number(operation.rateLimitCost || throttlePolicy.cost || 1),
    rateLimitScope: operation.rateLimitScope || throttlePolicy.scope || "store_token",
    throttlePolicy,
    retryAfterHeader: operation.retryAfterHeader || throttlePolicy.retryAfterHeader || "Retry-After",
    rateLimitHeaders: Array.isArray(operation.rateLimitHeaders) && operation.rateLimitHeaders.length ? operation.rateLimitHeaders : throttlePolicy.headers || [],
    rateLimitDescription: operation.rateLimitDescription || throttlePolicy.description || "Leaky bucket throttle scoped by store + API token/app.",
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
  const basePath = catalog.basePath || DEFAULT_ADMIN_API_BASE_PATH;
  const operations = capabilities.operations.map((operation) => normalizeOperation(operation, usedOperationIds));
  const registeredOperations = catalog.requiredOperations.length;
  const implementedOperations = operations.filter((operation) => operation.implemented).length;
  const sections = buildDocSections(operations);

  return {
    generatedAt,
    source: "myshopiyz/src/lib/adminApiCatalog.ts",
    basePath,
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
          ["quickstart", "Quickstart"],
          ["pagination", "Pagination"],
          ["filtering", "Filtering"],
          ["idempotency", "Idempotency"],
          ["preview-approval", "Preview and approval"],
          ["error-format", "Error format"],
          ["ai-tool-usage", "AI/tool usage"],
          ["implemented-planned", "Implemented vs planned"],
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
        openApiLink.href = "/openapi";
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
        "quickstart",
        "libraries",
        "authentication",
        "endpoints",
        "pagination",
        "filtering",
        "idempotency",
        "preview-approval",
        "error-format",
        "ai-tool-usage",
        "implemented-planned",
        "rate-limits",
        "status",
        "resource-reference",
        "operation-catalog",
        ...adminApiDoc.sections.flatMap((section) => [section.id, ...section.resources.map((resource) => resource.id)])
      ];
      const sections = observedSectionIds.map((id) => document.getElementById(id)).filter(Boolean);
${generatedSectionsEnd}`;
}

function updateAdminHtml(docData) {
  const adminPath = path.join(docsRoot, "admin.html");
  let html = fs.readFileSync(adminPath, "utf8");

  html = html
    .replace("<span>v1 preview</span>", "")
    .replace("<span>unversioned</span>", "")
    .replace('<a class="active" href="./">Admin API</a>', '<a class="active" href="/admin">Admin API</a>')
    .replace('<a href="./openapi/shopiyz-api.yaml">OpenAPI</a>', '<a href="/openapi">OpenAPI</a>')
    .replace('<li class="nav-open">', '<li>')
    .replace('if (activeItem) activeItem.classList.add("nav-open");', 'if (activeItem && id !== "overview") activeItem.classList.add("nav-open");')
    .replace(
      "Bu sayfa ilk REST Admin API yapisini anlatir. Endpointler yayina alindikca referans bolumu genisleyecek.",
        "Bu sayfa canli Admin API registry kaynaklarindan uretilir; tek yol /admin/api/v1 altindadir."
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
        "Shopiyz Admin API kaynak haritasi canli runtime registry'den uretilir. Bu bolum Customer, Product, Order, Collection, Inventory ve diger tum ailelerdeki mevcut operasyonlari tek /admin/api/v1 yolu altinda gosterir."
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

  html = html.replace(/\/admin\/api(?!\/v1)/g, docData.basePath);

  fs.writeFileSync(adminPath, html);
  fs.copyFileSync(adminPath, path.join(docsRoot, "public", "admin.html"));
}

function openApiPathParams(pathname) {
  return Array.from(pathname.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function normalizeSchemaRef(schemaRef) {
  return schemaRef || "#/components/schemas/AdminApiResponse";
}

function isGenericSchemaRef(schemaRef) {
  return ["#/components/schemas/AdminApiResponse", "#/components/schemas/AdminApiMutationRequest"].includes(normalizeSchemaRef(schemaRef));
}

function schemaNoteFor(operation) {
  const notes = [];
  if (operation.requestSchemaRef && isGenericSchemaRef(operation.requestSchemaRef)) {
    notes.push("Request body uses the generic mutation envelope because this operation currently accepts a flexible domain payload in runtime.");
  }
  if (isGenericSchemaRef(operation.responseSchemaRef)) {
    notes.push("Response uses the generic Admin API wrapper because a verified typed response model is not yet available for this endpoint.");
  }
  return notes.length ? notes.join(" ") : "";
}

function successStatusFor(operation) {
  if (String(operation.path || "").includes("preview")) return "200";
  if (operation.method === "POST") return "201";
  return "200";
}

function renderContentExamples(lines, examples, indent = 14) {
  if (!examples) return;
  const prefix = " ".repeat(indent);
  lines.push(`${prefix}examples:`);
  lines.push(`${prefix}  default:`);
  lines.push(`${prefix}    summary: Example payload`);
  lines.push(`${prefix}    value:`);
  lines.push(...yamlValue(examples, indent + 6));
}

function renderResponse(lines, status, schemaRef, example) {
  lines.push(`        "${status}":`);
  lines.push("          description: Successful response");
  lines.push("          headers:");
  for (const [name, component] of successRateLimitHeaderRefs) {
    lines.push(`            ${name}:`);
    lines.push(`              $ref: ${yamlString(`#/components/headers/${component}`)}`);
  }
  lines.push("          content:");
  lines.push("            application/json:");
  lines.push("              schema:");
  lines.push(`                $ref: ${yamlString(normalizeSchemaRef(schemaRef))}`);
  renderContentExamples(lines, example, 14);
}

function renderParameter(lines, parameter) {
  lines.push(`        - name: ${yamlString(parameter.name)}`);
  lines.push(`          in: ${yamlString(parameter.in)}`);
  lines.push(`          required: ${parameter.required ? "true" : "false"}`);
  lines.push(`          description: ${yamlString(parameter.description || "")}`);
  lines.push("          schema:");
  lines.push(`            type: ${yamlString(parameter.type || "string")}`);
  if (Array.isArray(parameter.enum) && parameter.enum.length) {
    lines.push("            enum:");
    lines.push(yamlList(parameter.enum, "              "));
  }
  if (parameter.default !== undefined) lines.push(`            default: ${yamlScalar(parameter.default)}`);
  if (parameter.example !== undefined) lines.push(`          example: ${yamlScalar(parameter.example)}`);
}

function operationParameters(operation) {
  const catalogParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  const byKey = new Map();
  for (const parameter of catalogParameters) {
    byKey.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  for (const name of openApiPathParams(operation.path)) {
    const key = `path:${name}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name,
        in: "path",
        required: true,
        type: "string",
        description: `${toTitle(name)} path parameter.`,
        example: `${name.replace(/_id$/, "")}_123`,
      });
    }
  }

  for (const header of operation.requiredHeaders || []) {
    if (["X-Shopiyz-Access-Token", "Authorization"].includes(header.name)) continue;
    const key = `header:${header.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: header.name,
        in: "header",
        required: Boolean(header.required),
        type: "string",
        description: header.description || `${header.name} header.`,
        example: header.example,
      });
    }
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const order = { path: 0, query: 1, header: 2 };
    return (order[left.in] ?? 9) - (order[right.in] ?? 9) || left.name.localeCompare(right.name);
  });
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
  lines.push(`      x-shopiyz-rate-limit-group: ${yamlString(operation.rateLimitGroup || operation.throttlePolicy?.group || "admin_api_global")}`);
  lines.push(`      x-shopiyz-rate-limit-cost: ${Number(operation.rateLimitCost || operation.throttlePolicy?.cost || 1)}`);
  lines.push(`      x-shopiyz-rate-limit-bucket: ${Number(operation.throttlePolicy?.bucketSize || 40)}`);
  lines.push(`      x-shopiyz-rate-limit-restore-rate: ${Number(operation.throttlePolicy?.restoreRatePerSecond || 2)}`);
  lines.push(`      x-shopiyz-rate-limit-scope: ${yamlString(operation.rateLimitScope || operation.throttlePolicy?.scope || "store_token")}`);
  lines.push(`      x-shopiyz-rate-limit-algorithm: ${yamlString(operation.throttlePolicy?.algorithm || "leaky_bucket")}`);
  lines.push("      x-shopiyz-rate-limit-headers:");
  lines.push(yamlList(operation.rateLimitHeaders || [], "        "));
  lines.push(`      x-shopiyz-implemented: ${operation.implemented ? "true" : "false"}`);
  lines.push(`      x-shopiyz-preview-required: ${operation.previewRequired ? "true" : "false"}`);
  lines.push(`      x-shopiyz-rollback-supported: ${operation.rollbackSupported ? "true" : "false"}`);
  lines.push(`      x-ai-safe: ${operation.aiSafety.safe ? "true" : "false"}`);
  lines.push(`      x-ai-readonly: ${operation.aiSafety.readOnly ? "true" : "false"}`);
  lines.push(`      x-ai-requires-confirmation: ${operation.aiSafety.requiresConfirmation ? "true" : "false"}`);
  lines.push(`      x-ai-destructive: ${operation.aiSafety.destructive ? "true" : "false"}`);
  lines.push(`      x-ai-idempotency-required: ${operation.aiSafety.idempotencyRequired ? "true" : "false"}`);
  lines.push(`      x-ai-human-summary: ${yamlString(operation.aiSafety.humanSummary)}`);
  lines.push("      x-ai-before-call:");
  lines.push(yamlList(operation.aiSafety.beforeCall || [], "        "));
  lines.push(`      x-operation-kind: ${yamlString(standardOperationKind(operation))}`);
  lines.push(`      x-risk: ${yamlString(operation.risk)}`);
  lines.push(`      x-confirmation: ${yamlString(standardConfirmation(operation.confirmation))}`);
  lines.push(`      x-step-up: ${yamlString(standardStepUp(operation.stepUp))}`);
  lines.push(`      x-idempotency: ${yamlString(standardIdempotency(operation))}`);
  lines.push(`      x-preview-supported: ${operation.previewRequired ? "true" : "false"}`);
  lines.push(`      x-rollback-supported: ${operation.rollbackSupported ? "true" : "false"}`);
  lines.push("      x-required-roles:");
  lines.push(yamlList(["merchant_staff"]));
  lines.push("      x-required-scopes:");
  lines.push(yamlList(requiredScopesFor(operation)));
  lines.push(`      x-audit-event: ${yamlString(operation.capability)}`);
  if (operation.requestSchemaRef) lines.push(`      x-request-schema: ${yamlString(operation.requestSchemaRef)}`);
  lines.push(`      x-response-schema: ${yamlString(normalizeSchemaRef(operation.responseSchemaRef))}`);
  const schemaNote = schemaNoteFor(operation);
  if (schemaNote) lines.push(`      x-shopiyz-schema-note: ${yamlString(schemaNote)}`);
  if (operation.requiredHeaders?.length) {
    lines.push("      x-required-headers:");
    lines.push(...yamlValue(operation.requiredHeaders, 8));
  }
  if (operation.examples) {
    lines.push("      x-examples:");
    lines.push(...yamlValue(operation.examples, 8));
  }

  const params = operationParameters(operation);
  if (params.length) {
    lines.push("      parameters:");
    for (const param of params) renderParameter(lines, param);
  }

  if (!["GET", "HEAD", "DELETE"].includes(operation.method)) {
    lines.push("      requestBody:");
    lines.push("        required: false");
    lines.push("        content:");
    lines.push("          application/json:");
    lines.push("            schema:");
    lines.push(`              $ref: ${yamlString(normalizeSchemaRef(operation.requestSchemaRef || "#/components/schemas/AdminApiMutationRequest"))}`);
    renderContentExamples(lines, operation.examples?.request, 12);
    if (operation.path === "/media_assets.json" && operation.method === "POST") {
      lines.push("          multipart/form-data:");
      lines.push("            schema:");
      lines.push("              $ref: '#/components/schemas/MediaAssetMultipartRequest'");
    }
  }

  lines.push("      responses:");
  renderResponse(lines, successStatusFor(operation), operation.responseSchemaRef, operation.examples?.response);
  const errorCodes = new Set(operation.errorCodes?.length ? operation.errorCodes : operationErrorResponseRefs.map(([status]) => status));
  for (const [status, responseRef] of operationErrorResponseRefs) {
    if (!errorCodes.has(status)) continue;
    lines.push(`        "${status}":`);
    lines.push(`          $ref: ${yamlString(responseRef)}`);
  }
  lines.push("      security:");
  lines.push("        - ShopiyzAccessToken: []");
  lines.push("        - ShopiyzBearerAuth: []");
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
    yamlBlock(`Shopiyz Admin API reference generated from the live Admin API registry. All endpoints use the ${docData.basePath} base path.`, "    "),
    "servers:",
    `  - url: https://{store}.shopiyz.com${docData.basePath}`,
    "    variables:",
    "      store:",
    "        default: development",
    "        description: Store subdomain or custom store host.",
    "x-shopiyz-generated-at: " + yamlString(docData.generatedAt),
    "x-shopiyz-source: " + yamlString(docData.source),
    "x-shopiyz-base-path: " + yamlString(docData.basePath),
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
  lines.push("    ShopiyzBearerAuth:");
  lines.push("      type: http");
  lines.push("      scheme: bearer");
  lines.push("      bearerFormat: shpat");
  lines.push("  headers:");
  for (const [name, header] of Object.entries(OPENAPI_RATE_LIMIT_HEADERS)) {
    lines.push(`    ${name}:`);
    lines.push(...yamlValue(header, 6));
  }
  lines.push("  responses:");
  for (const [name, response] of Object.entries(OPENAPI_ERROR_RESPONSES)) {
    lines.push(`    ${name}:`);
    lines.push(...yamlValue(response, 6));
  }
  lines.push("  schemas:");
  for (const [name, schema] of Object.entries(OPENAPI_COMPONENT_SCHEMAS)) {
    lines.push(`    ${name}:`);
    lines.push(...yamlValue(schema, 6));
  }
  lines.push("security:");
  lines.push("  - ShopiyzAccessToken: []");
  lines.push("  - ShopiyzBearerAuth: []");
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
updateAdminHtml(docData);
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
