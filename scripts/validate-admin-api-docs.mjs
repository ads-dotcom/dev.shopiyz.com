import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const yamlPath = path.join(root, "openapi", "shopiyz-api.yaml");
const indexPath = path.join(root, "public", "index.html");
const baselineArg = process.argv.find((arg) => arg.startsWith("--baseline="));
const baselinePath = baselineArg ? path.resolve(process.cwd(), baselineArg.slice("--baseline=".length)) : "";

const methods = new Set(["get", "post", "put", "patch", "delete", "head"]);
const requiredErrorStatuses = ["400", "401", "403", "404", "409", "422", "429", "500"];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function parseOpenApiOperations(yaml) {
  const lines = yaml.split(/\r?\n/);
  const operations = [];
  let currentPath = "";
  let current = null;

  const finish = () => {
    if (current) operations.push(current);
    current = null;
  };

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
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
        risk: "",
        confirmation: "",
        stepUp: "",
        implemented: true,
        idempotency: "",
        aiIdempotencyRequired: false,
        aiRequiresConfirmation: false,
      };
      continue;
    }
    if (!current) continue;

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

    const idempotency = line.match(/^      x-idempotency:\s*(.+)\s*$/);
    if (idempotency) current.idempotency = unquote(idempotency[1]);

    const aiIdempotency = line.match(/^      x-ai-idempotency-required:\s*(true|false)\s*$/);
    if (aiIdempotency) current.aiIdempotencyRequired = aiIdempotency[1] === "true";

    const aiConfirmation = line.match(/^      x-ai-requires-confirmation:\s*(true|false)\s*$/);
    if (aiConfirmation) current.aiRequiresConfirmation = aiConfirmation[1] === "true";

    const param = line.match(/^        - name:\s*(.+)\s*$/);
    if (param) current.parameters.push(unquote(param[1]));

    const response = line.match(/^        "([0-9]{3})":\s*$/);
    if (response) current.responses.add(response[1]);

    if (line.match(/^      security:\s*$/)) current.security = true;
  }
  finish();
  return operations;
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

function parsePublicCatalogCount(html) {
  const start = html.indexOf("const adminApiDoc = ");
  if (start < 0) fail("public catalog adminApiDoc block not found");
  const jsonStart = start + "const adminApiDoc = ".length;
  const end = html.indexOf(";\n      const operationRows", jsonStart);
  if (end < 0) fail("public catalog adminApiDoc block end not found");
  const doc = JSON.parse(html.slice(jsonStart, end));
  return {
    operations: doc.operations?.length || 0,
    summaryOperations: doc.summary?.operations || 0,
  };
}

function operationKey(operation) {
  return `${operation.method} ${operation.path} ${operation.operationId}`;
}

function pathParams(pathname) {
  return Array.from(pathname.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
}

function validate() {
  const yaml = read(yamlPath);
  if (!yaml.includes("openapi: 3.1.0")) fail("OpenAPI version header missing");
  const operations = parseOpenApiOperations(yaml);
  if (!operations.length) fail("No OpenAPI operations parsed");

  const operationIds = new Map();
  const duplicateOperationIds = [];
  for (const operation of operations) {
    const current = operationIds.get(operation.operationId) || 0;
    if (current) duplicateOperationIds.push(operation.operationId);
    operationIds.set(operation.operationId, current + 1);
  }
  if (duplicateOperationIds.length) fail("Duplicate operationId values found", { duplicateOperationIds: duplicateOperationIds.slice(0, 20) });

  if (baselinePath) {
    const baseline = JSON.parse(read(baselinePath));
    const afterKeys = new Set(operations.map(operationKey));
    const missing = (baseline.operations || []).filter((operation) => !afterKeys.has(operationKey(operation)));
    if (missing.length) fail("OpenAPI inventory lost operations", { missing: missing.slice(0, 20), missingCount: missing.length });
  }

  for (const operation of operations) {
    if (!operation.operationId) fail("Operation missing operationId", operation);
    const missingPathParams = pathParams(operation.path).filter((param) => !operation.parameters.includes(param));
    if (missingPathParams.length) fail("Path parameters are not documented", { operation, missingPathParams });
    if (operation.implemented && !operation.security) fail("Implemented operation missing security", operation);
    const missingErrors = requiredErrorStatuses.filter((status) => !operation.responses.has(status));
    if (missingErrors.length) fail("Operation missing standard error responses", { operation, missingErrors });
    if (["POST", "PUT", "PATCH", "DELETE"].includes(operation.method) && !operation.idempotency) {
      fail("Write/delete operation missing idempotency metadata", operation);
    }
    if (operation.aiIdempotencyRequired && !operation.parameters.includes("Idempotency-Key")) {
      fail("Idempotent operation missing Idempotency-Key header", operation);
    }
    if (["R3", "R4", "R5"].includes(operation.risk) && (!operation.confirmation || !operation.stepUp)) {
      fail("High risk operation missing confirmation/step-up metadata", operation);
    }
  }

  const publicCatalog = parsePublicCatalogCount(read(indexPath));
  if (publicCatalog.operations !== operations.length || publicCatalog.summaryOperations !== operations.length) {
    fail("Public catalog operation count differs from OpenAPI", { publicCatalog, openApiOperations: operations.length });
  }

  return {
    operations: operations.length,
    duplicateOperationIds: duplicateOperationIds.length,
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
