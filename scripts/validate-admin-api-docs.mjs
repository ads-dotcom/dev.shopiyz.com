import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const yamlPath = path.join(root, "openapi", "shopiyz-api.yaml");
const indexPath = path.join(root, "public", "index.html");
const baselineArg = process.argv.find((arg) => arg.startsWith("--baseline="));
const baselinePath = baselineArg ? path.resolve(process.cwd(), baselineArg.slice("--baseline=".length)) : "";

const expectedBasePath = "/admin/api/v1";
const methods = new Set(["get", "post", "put", "patch", "delete", "head"]);
const requiredErrorStatuses = ["400", "401", "403", "404", "409", "422", "429", "500"];
const requiredAiFields = [
  "x-ai-safe",
  "x-ai-readonly",
  "x-ai-requires-confirmation",
  "x-ai-destructive",
  "x-ai-idempotency-required",
  "x-ai-human-summary",
  "x-ai-before-call",
];
const requiredRateLimitFields = [
  "x-shopiyz-rate-limit-group",
  "x-shopiyz-rate-limit-cost",
  "x-shopiyz-rate-limit-bucket",
  "x-shopiyz-rate-limit-restore-rate",
  "x-shopiyz-rate-limit-scope",
];
const requiredRateLimitSuccessHeaders = [
  "X-Shopiyz-Api-Call-Limit",
  "X-Shopiyz-Api-Bucket-Size",
  "X-Shopiyz-Api-Restore-Rate",
  "X-Shopiyz-Api-Cost",
  "X-Shopiyz-RateLimit-Remaining",
  "X-Request-Id",
];
const requiredRateLimitDocsSnippets = [
  "Overview",
  "Leaky bucket model",
  "Plan based limits",
  "Operation costs",
  "Rate limit headers",
  "429 Too Many Requests",
  "Retry and backoff recommendations",
  "Pagination and bulk operation recommendations",
  "AI agent recommendations",
  "Node.js fetch ile 429",
  "PHP/cURL",
];
const genericSchemaRefs = new Set(["#/components/schemas/AdminApiResponse", "#/components/schemas/AdminApiMutationRequest"]);
const requiredTypedRequestSchemas = new Map([
  ["POST /pages.json", "#/components/schemas/PageRequest"],
  ["PATCH /pages/{page_id}.json", "#/components/schemas/PageRequest"],
  ["PATCH /settings/policies.json", "#/components/schemas/PolicySettingsRequest"],
  ["POST /legal_documents.json", "#/components/schemas/LegalDocumentRequest"],
  ["PATCH /legal_documents/{document_id}.json", "#/components/schemas/LegalDocumentRequest"],
  ["POST /legal_documents/preview_bundle.json", "#/components/schemas/LegalDocumentBundleRequest"],
  ["POST /legal_documents/apply_bundle.json", "#/components/schemas/LegalDocumentBundleRequest"],
  ["POST /menus.json", "#/components/schemas/MenuRequest"],
  ["PATCH /menus/{menu_id}.json", "#/components/schemas/MenuRequest"],
  ["POST /menus/{menu_id}/items.json", "#/components/schemas/MenuItemRequest"],
  ["PATCH /menus/{menu_id}/items/{item_id}.json", "#/components/schemas/MenuItemRequest"],
  ["POST /orders/{order_id}/withdrawals.json", "#/components/schemas/WithdrawalRequest"],
  ["POST /api_tokens.json", "#/components/schemas/ApiTokenInput"],
  ["POST /storefront/tokens.json", "#/components/schemas/StorefrontTokenInput"],
  ["POST /users.json", "#/components/schemas/UserInput"],
  ["PATCH /users/{user_id}.json", "#/components/schemas/UserUpdateInput"],
  ["POST /roles.json", "#/components/schemas/RoleInput"],
  ["PATCH /roles/{role_id}.json", "#/components/schemas/RoleUpdateInput"],
  ["POST /webhooks.json", "#/components/schemas/WebhookInput"],
  ["PATCH /webhooks/{webhook_id}.json", "#/components/schemas/WebhookUpdateInput"],
  ["PATCH /settings/payments.json", "#/components/schemas/PaymentSettingsInput"],
  ["POST /settings/payments/providers.json", "#/components/schemas/PaymentProviderInput"],
  ["PATCH /settings/payments/providers/{provider_id}.json", "#/components/schemas/PaymentProviderInput"],
  ["PATCH /settings/customer_privacy.json", "#/components/schemas/CustomerPrivacySettingsInput"],
  ["POST /domains.json", "#/components/schemas/DomainInput"],
  ["PATCH /domains/{domain_id}.json", "#/components/schemas/DomainInput"],
  ["POST /dns_records.json", "#/components/schemas/DnsRecordInput"],
  ["PATCH /dns_records/{record_id}.json", "#/components/schemas/DnsRecordInput"],
  ["POST /ssl_certificates.json", "#/components/schemas/SslCertificateInput"],
  ["POST /ssl_certificates/{certificate_id}/renew.json", "#/components/schemas/SslCertificateInput"],
]);

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.replace(/^"|"$/g, "");
    }
  }
  return trimmed;
}

function parsePublicCatalog(html) {
  const start = html.indexOf("const adminApiDoc = ");
  if (start < 0) fail("public catalog adminApiDoc block not found");
  const jsonStart = start + "const adminApiDoc = ".length;
  const end = html.indexOf(";\n      const operationRows", jsonStart);
  if (end < 0) fail("public catalog adminApiDoc block end not found");
  return JSON.parse(html.slice(jsonStart, end));
}

function parseOpenApi(yaml) {
  const lines = yaml.split(/\r?\n/);
  const operations = [];
  const schemas = new Set();
  const refs = new Set();
  const securitySchemes = new Set();
  const servers = [];
  let xBasePath = "";
  let currentPath = "";
  let current = null;
  let currentParameter = null;
  let section = "";

  const finish = () => {
    if (!current) return;
    current.raw = current.rawLines.join("\n");
    current.hasExamples = current.raw.includes("examples:") || current.raw.includes("x-examples:");
    operations.push(current);
    current = null;
    currentParameter = null;
  };

  for (const line of lines) {
    for (const match of line.matchAll(/#\/components\/schemas\/([A-Za-z0-9_]+)/g)) {
      refs.add(match[1]);
    }

    if (line === "paths:") section = "paths";
    if (line === "components:") section = "components";
    if (line.match(/^  schemas:\s*$/)) section = "schemas";
    if (line.match(/^  securitySchemes:\s*$/)) section = "securitySchemes";

    const server = line.match(/^  - url:\s*(.+)\s*$/);
    if (server) servers.push(unquote(server[1]));

    const basePath = line.match(/^x-shopiyz-base-path:\s*(.+)\s*$/);
    if (basePath) xBasePath = unquote(basePath[1]);

    if (section === "schemas") {
      const schema = line.match(/^    ([A-Za-z0-9_]+):\s*$/);
      if (schema) schemas.add(schema[1]);
    }

    if (section === "securitySchemes") {
      const scheme = line.match(/^    ([A-Za-z0-9_]+):\s*$/);
      if (scheme) securitySchemes.add(scheme[1]);
    }

    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch && section === "paths") {
      finish();
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^    ([a-z]+):\s*$/);
    if (methodMatch && methods.has(methodMatch[1])) {
      finish();
      current = {
        path: currentPath,
        method: methodMatch[1].toUpperCase(),
        operationId: "",
        security: false,
        parameters: [],
        responses: new Set(),
        aiFields: new Set(),
        risk: "",
        confirmation: "",
        stepUp: "",
        implemented: true,
        idempotency: "",
        requestSchemaRef: null,
        responseSchemaRef: "",
        schemaNote: "",
        rateLimitFields: new Set(),
        rateLimitGroup: "",
        rateLimitCost: 0,
        rateLimitBucket: 0,
        rateLimitRestoreRate: 0,
        rateLimitScope: "",
        rawLines: [line],
      };
      continue;
    }

    if (!current) continue;
    current.rawLines.push(line);

    const operationId = line.match(/^      operationId:\s*(.+)\s*$/);
    if (operationId) current.operationId = unquote(operationId[1]);

    const risk = line.match(/^      x-shopiyz-risk:\s*(.+)\s*$/);
    if (risk) current.risk = unquote(risk[1]);

    const confirmation = line.match(/^      x-shopiyz-confirmation:\s*(.+)\s*$/);
    if (confirmation) current.confirmation = unquote(confirmation[1]);

    const stepUp = line.match(/^      x-shopiyz-step-up:\s*(.+)\s*$/);
    if (stepUp) current.stepUp = unquote(stepUp[1]);

    const implemented = line.match(/^      x-shopiyz-implemented:\s*(true|false)\s*$/);
    if (implemented) current.implemented = implemented[1] === "true";

    const requestSchema = line.match(/^      x-request-schema:\s*(.+)\s*$/);
    if (requestSchema) current.requestSchemaRef = unquote(requestSchema[1]);

    const responseSchema = line.match(/^      x-response-schema:\s*(.+)\s*$/);
    if (responseSchema) current.responseSchemaRef = unquote(responseSchema[1]);

    const schemaNote = line.match(/^      x-shopiyz-schema-note:\s*(.+)\s*$/);
    if (schemaNote) current.schemaNote = unquote(schemaNote[1]);

    const idempotency = line.match(/^      x-idempotency:\s*(.+)\s*$/);
    if (idempotency) current.idempotency = unquote(idempotency[1]);

    const ai = line.match(/^      (x-ai-[a-z-]+):/);
    if (ai) current.aiFields.add(ai[1]);

    const rateLimit = line.match(/^      (x-shopiyz-rate-limit-[a-z-]+):\s*(.*)\s*$/);
    if (rateLimit) {
      current.rateLimitFields.add(rateLimit[1]);
      const value = unquote(rateLimit[2]);
      if (rateLimit[1] === "x-shopiyz-rate-limit-group") current.rateLimitGroup = value;
      if (rateLimit[1] === "x-shopiyz-rate-limit-cost") current.rateLimitCost = Number(value);
      if (rateLimit[1] === "x-shopiyz-rate-limit-bucket") current.rateLimitBucket = Number(value);
      if (rateLimit[1] === "x-shopiyz-rate-limit-restore-rate") current.rateLimitRestoreRate = Number(value);
      if (rateLimit[1] === "x-shopiyz-rate-limit-scope") current.rateLimitScope = value;
    }

    const param = line.match(/^        - name:\s*(.+)\s*$/);
    if (param) {
      currentParameter = { name: unquote(param[1]), in: "", required: false, description: "" };
      current.parameters.push(currentParameter);
      continue;
    }
    if (currentParameter) {
      const paramIn = line.match(/^          in:\s*(.+)\s*$/);
      if (paramIn) currentParameter.in = unquote(paramIn[1]);
      const required = line.match(/^          required:\s*(true|false)\s*$/);
      if (required) currentParameter.required = required[1] === "true";
      const description = line.match(/^          description:\s*(.+)\s*$/);
      if (description) currentParameter.description = unquote(description[1]);
    }

    const response = line.match(/^        "([0-9]{3})":\s*$/);
    if (response) current.responses.add(response[1]);

    if (line.match(/^      security:\s*$/)) current.security = true;
  }
  finish();

  return { operations, schemas, refs, securitySchemes, servers, xBasePath };
}

function operationKey(operation) {
  return `${operation.method} ${operation.path} ${operation.operationId}`;
}

function pathParams(pathname) {
  return Array.from(pathname.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function schemaName(schemaRef) {
  const match = String(schemaRef || "").match(/^#\/components\/schemas\/(.+)$/);
  return match ? match[1] : "";
}

function isGeneric(schemaRef) {
  return genericSchemaRefs.has(schemaRef || "");
}

function validate() {
  const yaml = read(yamlPath);
  const publicHtml = read(indexPath);
  if (!yaml.includes("openapi: 3.1.0")) fail("OpenAPI version header missing");

  const publicCatalog = parsePublicCatalog(publicHtml);
  const parsed = parseOpenApi(yaml);
  const operations = parsed.operations;
  if (!operations.length) fail("No OpenAPI operations parsed");
  if (!publicHtml.includes('id="rate-limits"')) fail("Docs Rate Limits section missing");
  const missingDocsSnippets = requiredRateLimitDocsSnippets.filter((snippet) => !publicHtml.includes(snippet));
  if (missingDocsSnippets.length) fail("Docs Rate Limits section is missing required content", { missingDocsSnippets });

  if (publicCatalog.basePath !== expectedBasePath) {
    fail("Public catalog basePath differs from runtime base path", { publicBasePath: publicCatalog.basePath, expectedBasePath });
  }
  if (parsed.xBasePath !== expectedBasePath) {
    fail("OpenAPI x-shopiyz-base-path differs from runtime base path", { openApiBasePath: parsed.xBasePath, expectedBasePath });
  }
  if (!parsed.servers.some((url) => url.includes(expectedBasePath))) {
    fail("OpenAPI server URL does not include runtime base path", { servers: parsed.servers, expectedBasePath });
  }

  if (!parsed.securitySchemes.has("ShopiyzAccessToken") || !parsed.securitySchemes.has("ShopiyzBearerAuth")) {
    fail("OpenAPI security schemes missing token or bearer auth", { securitySchemes: Array.from(parsed.securitySchemes) });
  }

  const duplicateOperationIds = [];
  const operationIds = new Map();
  for (const operation of operations) {
    const current = operationIds.get(operation.operationId) || 0;
    if (current) duplicateOperationIds.push(operation.operationId);
    operationIds.set(operation.operationId, current + 1);
  }
  if (duplicateOperationIds.length) fail("Duplicate operationId values found", { duplicateOperationIds: duplicateOperationIds.slice(0, 20) });

  const operationsByKey = new Map(operations.map((operation) => [operationKey(operation), operation]));
  const catalogOperations = publicCatalog.operations || [];
  const catalogKeys = new Set(catalogOperations.map(operationKey));
  const missingFromOpenApi = catalogOperations.filter((operation) => !operationsByKey.has(operationKey(operation)));
  if (missingFromOpenApi.length) fail("Catalog operations missing from OpenAPI", { missing: missingFromOpenApi.slice(0, 20), missingCount: missingFromOpenApi.length });

  if (baselinePath) {
    const baseline = JSON.parse(read(baselinePath));
    const afterKeys = new Set(operations.map(operationKey));
    const missing = (baseline.operations || []).filter((operation) => !afterKeys.has(operationKey(operation)));
    if (missing.length) fail("OpenAPI inventory lost operations", { missing: missing.slice(0, 20), missingCount: missing.length });
  }

  const refsWithoutSchemas = Array.from(parsed.refs).filter((name) => !parsed.schemas.has(name));
  if (refsWithoutSchemas.length) fail("OpenAPI references schemas that are not defined", { refsWithoutSchemas: refsWithoutSchemas.slice(0, 40), count: refsWithoutSchemas.length });
  if (!parsed.schemas.has("RateLimitError")) fail("OpenAPI RateLimitError schema is missing");
  if (!yaml.includes("  headers:\n    XShopiyzApiCallLimit:")) fail("OpenAPI reusable rate limit header components are missing");
  if (!yaml.includes("Retry-After:") || !yaml.includes("X-Shopiyz-Api-Call-Limit:")) {
    fail("OpenAPI rate limit response headers are missing");
  }

  const catalogSchemaRefs = new Set();
  for (const operation of catalogOperations) {
    if (operation.requestSchemaRef) catalogSchemaRefs.add(operation.requestSchemaRef);
    if (operation.responseSchemaRef) catalogSchemaRefs.add(operation.responseSchemaRef);
  }
  const catalogRefsWithoutSchemas = Array.from(catalogSchemaRefs)
    .map((ref) => ({ ref, name: schemaName(ref) }))
    .filter(({ name }) => name && !parsed.schemas.has(name));
  if (catalogRefsWithoutSchemas.length) fail("Catalog schemaRef missing OpenAPI component schema", { catalogRefsWithoutSchemas });

  const operationsByMethodPath = new Map(operations.map((operation) => [`${operation.method} ${operation.path}`, operation]));
  const typedRequestMismatches = [];
  for (const [key, expectedRef] of requiredTypedRequestSchemas.entries()) {
    const operation = operationsByMethodPath.get(key);
    if (!operation) {
      typedRequestMismatches.push({ key, expectedRef, problem: "operation_missing" });
      continue;
    }
    if (operation.requestSchemaRef !== expectedRef) {
      typedRequestMismatches.push({ key, expectedRef, actualRef: operation.requestSchemaRef || null, problem: "request_schema_mismatch" });
    }
    if (isGeneric(operation.requestSchemaRef)) {
      typedRequestMismatches.push({ key, expectedRef, actualRef: operation.requestSchemaRef || null, problem: "generic_request_schema" });
    }
  }
  if (typedRequestMismatches.length) fail("Production-ready operations are missing typed request schemas", { typedRequestMismatches });

  const metrics = {
    openApiOperations: operations.length,
    catalogOperations: catalogOperations.length,
    schemas: parsed.schemas.size,
    queryParameters: 0,
    headerParameters: 0,
    pathParameters: 0,
    errorResponseOperations: 0,
    exampleOperations: 0,
    aiMetadataOperations: 0,
    rateLimitMetadataOperations: 0,
    rateLimitSuccessHeaderOperations: 0,
    genericRequestWithNote: 0,
    genericResponseWithNote: 0,
    missingEndpointCount: missingFromOpenApi.length,
    basePath: expectedBasePath,
  };

  for (const catalogOperation of catalogOperations) {
    const openApiOperation = operationsByKey.get(operationKey(catalogOperation));
    if (!openApiOperation) continue;

    if (!openApiOperation.operationId) fail("Operation missing operationId", openApiOperation);
    if (catalogOperation.implemented && !openApiOperation.security) fail("Implemented operation missing security", openApiOperation);

    if (catalogOperation.requestSchemaRef && openApiOperation.requestSchemaRef !== catalogOperation.requestSchemaRef) {
      fail("OpenAPI request schema does not match catalog requestSchemaRef", { catalogOperation, openApiOperation });
    }
    if (catalogOperation.responseSchemaRef && openApiOperation.responseSchemaRef !== catalogOperation.responseSchemaRef) {
      fail("OpenAPI response schema does not match catalog responseSchemaRef", { catalogOperation, openApiOperation });
    }

    const openApiParameters = new Set(openApiOperation.parameters.map((parameter) => `${parameter.in}:${parameter.name}`));
    for (const parameter of catalogOperation.parameters || []) {
      const key = `${parameter.in}:${parameter.name}`;
      if (!openApiParameters.has(key)) fail("Catalog parameter missing from OpenAPI operation", { operation: catalogOperation, parameter });
    }

    for (const name of pathParams(catalogOperation.path)) {
      const pathParameter = openApiOperation.parameters.find((parameter) => parameter.in === "path" && parameter.name === name);
      if (!pathParameter || !pathParameter.description) fail("Path parameter missing description", { operation: catalogOperation, pathParameter: name });
    }

    for (const header of catalogOperation.requiredHeaders || []) {
      if (["X-Shopiyz-Access-Token", "Authorization"].includes(header.name)) continue;
      if (!openApiParameters.has(`header:${header.name}`)) fail("Required header missing from OpenAPI parameters", { operation: catalogOperation, header });
    }

    const missingErrors = (catalogOperation.errorCodes || requiredErrorStatuses).filter((status) => !openApiOperation.responses.has(status));
    if (missingErrors.length) fail("Catalog errorCodes missing from OpenAPI responses", { operation: catalogOperation, missingErrors });

    if (catalogOperation.aiSafety) {
      const missingAiFields = requiredAiFields.filter((field) => !openApiOperation.aiFields.has(field));
      if (missingAiFields.length) fail("Catalog aiSafety missing OpenAPI x-ai metadata", { operation: catalogOperation, missingAiFields });
    }

    const missingRateLimitFields = requiredRateLimitFields.filter((field) => !openApiOperation.rateLimitFields.has(field));
    if (missingRateLimitFields.length) fail("Catalog rate limit metadata missing from OpenAPI operation", { operation: catalogOperation, missingRateLimitFields });
    if (!catalogOperation.rateLimitGroup || !catalogOperation.rateLimitCost || !catalogOperation.rateLimitScope || !catalogOperation.throttlePolicy || !catalogOperation.rateLimitDescription) {
      fail("Public catalog rate limit metadata missing", { operation: catalogOperation });
    }
    if (openApiOperation.rateLimitGroup !== catalogOperation.rateLimitGroup) {
      fail("OpenAPI rate limit group differs from public catalog", { catalogOperation, openApiOperation });
    }
    if (openApiOperation.rateLimitScope !== catalogOperation.rateLimitScope) {
      fail("OpenAPI rate limit scope differs from public catalog", { catalogOperation, openApiOperation });
    }
    if (Number(openApiOperation.rateLimitCost) !== Number(catalogOperation.rateLimitCost)) {
      fail("OpenAPI rate limit cost differs from public catalog", { catalogOperation, openApiOperation });
    }
    if (openApiOperation.rateLimitBucket <= 0 || openApiOperation.rateLimitRestoreRate <= 0) {
      fail("OpenAPI rate limit policy has invalid bucket or restore rate", { openApiOperation });
    }
    if (!openApiOperation.raw.includes("description: Successful response\n          headers:")) {
      fail("OpenAPI successful response is missing rate limit header block", { openApiOperation });
    }
    const missingSuccessHeaders = requiredRateLimitSuccessHeaders.filter((header) => !openApiOperation.raw.includes(`            ${header}:`));
    if (missingSuccessHeaders.length) fail("OpenAPI successful response is missing rate limit headers", { operation: catalogOperation, missingSuccessHeaders });

    if (catalogOperation.examples && !openApiOperation.hasExamples) {
      fail("Catalog examples missing from OpenAPI operation", { operation: catalogOperation });
    }

    if (catalogOperation.implemented) {
      const hasGenericRequest = !["GET", "HEAD", "DELETE"].includes(catalogOperation.method) && isGeneric(openApiOperation.requestSchemaRef);
      const hasGenericResponse = isGeneric(openApiOperation.responseSchemaRef);
      if ((hasGenericRequest || hasGenericResponse) && !openApiOperation.schemaNote) {
        fail("Implemented operation uses generic schema without x-shopiyz-schema-note", { operation: catalogOperation, openApiOperation });
      }
      if (hasGenericRequest) metrics.genericRequestWithNote += 1;
      if (hasGenericResponse) metrics.genericResponseWithNote += 1;
    }

    metrics.queryParameters += openApiOperation.parameters.filter((parameter) => parameter.in === "query").length;
    metrics.headerParameters += openApiOperation.parameters.filter((parameter) => parameter.in === "header").length;
    metrics.pathParameters += openApiOperation.parameters.filter((parameter) => parameter.in === "path").length;
    if ((catalogOperation.errorCodes || requiredErrorStatuses).every((status) => openApiOperation.responses.has(status))) metrics.errorResponseOperations += 1;
    if (openApiOperation.hasExamples) metrics.exampleOperations += 1;
    if (requiredAiFields.every((field) => openApiOperation.aiFields.has(field))) metrics.aiMetadataOperations += 1;
    if (requiredRateLimitFields.every((field) => openApiOperation.rateLimitFields.has(field))) metrics.rateLimitMetadataOperations += 1;
    if (requiredRateLimitSuccessHeaders.every((header) => openApiOperation.raw.includes(`            ${header}:`))) metrics.rateLimitSuccessHeaderOperations += 1;
  }

  if (operations.length !== catalogOperations.length || publicCatalog.summary?.operations !== operations.length) {
    fail("Public catalog operation count differs from OpenAPI", {
      publicCatalogOperations: catalogOperations.length,
      publicCatalogSummaryOperations: publicCatalog.summary?.operations,
      openApiOperations: operations.length,
    });
  }

  return {
    ...metrics,
    duplicateOperationIds: duplicateOperationIds.length,
    undefinedSchemaRefs: refsWithoutSchemas.length,
    baseline: baselinePath || null,
  };
}

try {
  console.log(JSON.stringify(validate(), null, 2));
} catch (error) {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}
