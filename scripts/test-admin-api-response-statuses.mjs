import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {normalizeOperation, renderOpenApiOperation, successStatusesFor, scopeRequirementText, operationContractNotes, serializeDocData} from "./sync-admin-api-docs.mjs";
import {parseOpenApi, validateOperationResponses, validateOperationAuthority, validateStaticAssetBudget} from "./validate-admin-api-docs.mjs";

test("compact catalog serialization preserves all data and inline-script escaping", () => {
  const fixture = {sections: [{name: "Türkçe", description: "</script>\u2028\u2029", operations: [{method: "POST", scopes: [["settings:write", "orders:write"]], value: "line1\nline2"}]}]};
  const encoded = serializeDocData(fixture);
  assert.deepEqual(JSON.parse(encoded), fixture);
  assert(!encoded.includes("<") && !encoded.includes("\u2028") && !encoded.includes("\u2029"));
  assert(encoded.length < JSON.stringify(fixture, null, 2).length);
});

test("normal asset budget check allows25MiB and rejects one byte above it, including nested assets", () => {
  const directory = fs.mkdtempSync(path.resolve(import.meta.dirname, "../.asset-budget-test-"));
  try {
    fs.mkdirSync(path.join(directory, "nested"));
    const file = path.join(directory, "nested", "fixture.html");
    fs.writeFileSync(file, "");
    const maximum = 25 * 1024 * 1024;
    fs.truncateSync(file, maximum);
    assert.deepEqual(validateStaticAssetBudget(directory), {files: 1, maximumFileBytes: maximum, limitBytes: maximum});
    fs.truncateSync(file, maximum + 1);
    assert.throws(() => validateStaticAssetBudget(directory), error => error.details.file === "nested/fixture.html" && error.details.bytes === maximum + 1);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

const operation = overrides => normalizeOperation({
  method: "POST", path: "/fixture.json", operationId: "fixtureStatus", capability: "fixture.status",
  summary: "Fixture operation", description: "Source-derived response fixture", operationKind: "write",
  risk: "R2", confirmation: "none", stepUp: "none", implemented: true,
  requestSchemaRef: "#/components/schemas/FixtureRequest", responseSchemaRef: "#/components/schemas/FixtureResponse",
  ...overrides,
}, new Set());

const yaml = value => "openapi: 3.1.0\npaths:\n  /admin/api/v1/fixture.json:\n" + renderOpenApiOperation(value, "Fixture") + "\n";
const parsed = value => parseOpenApi(yaml(value)).operations[0];
const successes = value => [...value.responses].filter(status => /^2(?:[0-9]{2}|XX)$/.test(status));

test("unavailable POST overrides even planned success metadata with501 and no successful response", () => {
  const value = operation({implemented: false, successStatus: 201, successStatuses: [200, 202]});
  const result = parsed(value);
  assert.deepEqual(successStatusesFor(value), []);
  assert.deepEqual(successes(result), []);
  assert(result.responses.has("501"));
  assert.match(result.responseBlocks.get("501"), /components\/responses\/NotImplemented/);
  assert.equal(result.implemented, false);
  assert.equal(validateOperationResponses(value, result).kind, "planned501");
});

test("unavailable GET does not invent200 or require a success header block", () => {
  const value = operation({method: "GET", implemented: false});
  const result = parsed(value);
  assert.deepEqual(successes(result), []);
  assert(result.responses.has("501"));
  assert.equal(validateOperationResponses(value, result).kind, "planned501");
});

test("explicit Native single success status preserves actual200,201 or202", () => {
  for (const status of [200, 201, 202]) {
    const value = operation({successStatus: status});
    assert.deepEqual(successes(parsed(value)), [String(status)]);
    assert.equal(validateOperationResponses(value, parsed(value)).kind, "explicit");
  }
});

test("verified Native multiple statuses retain all valid statuses and every success header block", () => {
  const value = operation({successStatus: 201, successStatuses: [200, 202, 200]});
  const result = parsed(value);
  assert.deepEqual(successes(result), ["200", "202"]);
  assert.equal(validateOperationResponses(value, result).kind, "explicit");
  for (const status of ["200", "202"]) assert.match(result.responseBlocks.get(status), /X-Shopiyz-Api-Call-Limit:/);
});

test("unknown POST actions, previews and creates use2XX rather than a guessed concrete status", () => {
  for (const path of ["/jobs/start.json", "/discounts/preview.json", "/products.json"]) {
    const value = operation({path});
    const result = parsed(value);
    assert.deepEqual(successes(result), ["2XX"]);
    assert.match(result.responseBlocks.get("2XX"), /exact status is not yet verified/);
    assert.equal(validateOperationResponses(value, result).kind, "range2XX");
  }
});

test("existing non-POST200 fallback remains unchanged without explicit metadata", () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    const value = operation({method});
    assert.deepEqual(successes(parsed(value)), ["200"]);
    assert.equal(validateOperationResponses(value, parsed(value)).kind, "default200");
  }
});

test("validator rejects invented success or missing availability on unavailable operations", () => {
  const value = operation({implemented: false});
  const invented = parsed(value);
  invented.responses.add("201");
  assert.throws(() => validateOperationResponses(value, invented), /must not advertise a successful response/);
  const missing = parsed(value);
  missing.responses.delete("501");
  assert.throws(() => validateOperationResponses(value, missing), /must declare501/);
});

test("validator rejects loss of explicit statuses and guessed201 for an unverified POST", () => {
  const concrete = parsed(operation({successStatus: 201}));
  assert.throws(() => validateOperationResponses(operation(), concrete), /success statuses differ/);
  assert.throws(() => validateOperationResponses(operation({successStatuses: [200, 202]}), parsed(operation({successStatus: 200}))), /success statuses differ/);
});

test("each concrete or2XX success must carry rate headers even when another response has them", () => {
  for (const value of [operation(), operation({successStatuses: [200, 202]})]) {
    const broken = yaml(value).replace("            X-Shopiyz-Api-Call-Limit:", "            Missing-Expected-Header:");
    assert.throws(() => validateOperationResponses(value, parseOpenApi(broken).operations[0]), /missing rate limit headers/);
  }
});

test("additional source-declared Native errors remain in the generated contract", () => {
  const value = operation({method: "GET", successStatus: 200, errorCodes: ["400", "413", "502", "503"]});
  const result = parsed(value);
  for (const status of ["413", "502", "503"]) {
    assert(result.responses.has(status));
    assert.match(result.responseBlocks.get(status), /schemas\/AdminApiError/);
  }
  assert.equal(validateOperationResponses(value, result).kind, "explicit");
});

test("generated quoted2XX is a standard OpenAPI3.1 response key and parses as YAML", () => {
  const source = yaml(operation());
  const output = execFileSync(process.env.PYTHON || "/usr/bin/python3", ["-c", [
    "import sys,yaml,json",
    "spec=yaml.safe_load(sys.stdin.read())",
    "assert spec['openapi']=='3.1.0'",
    "responses=spec['paths']['/admin/api/v1/fixture.json']['post']['responses']",
    "assert '2XX' in responses and '201' not in responses",
    "assert 'X-Shopiyz-Api-Call-Limit' in responses['2XX']['headers']",
    "print(json.dumps({'responseRange':'2XX','yaml':True}))",
  ].join("\n")], {input: source, encoding: "utf8"});
  assert.equal(JSON.parse(output).responseRange, "2XX");
});

const native = overrides => operation({
  requiredScopes: ["admin:write"], requiredScopeAlternatives: [["admin:write"], ["settings:write", "products:write"]],
  nativePermissions: ["settings:manage", "products:manage"], readOnly: true, idempotencyRequired: false,
  queryParameters: [], ...overrides,
});

test("Native token alternatives remain OR groups of AND scopes, separate from all Native permissions", () => {
  const value = native(), result = parsed(value);
  assert.deepEqual(value.requiredScopes, ["admin:write"]);
  assert.deepEqual(value.requiredScopeAlternatives, [["admin:write"], ["settings:write", "products:write"]]);
  assert.equal(scopeRequirementText(value), "admin:write OR (settings:write AND products:write)");
  assert.deepEqual(result.scopeAlternatives, value.requiredScopeAlternatives);
  assert.deepEqual(result.nativePermissions, ["settings:manage", "products:manage"]);
  assert.equal(result.scopeMatching, "any group, all scopes within that group");
  assert.doesNotThrow(() => validateOperationAuthority(value, result));
});

test("Native read-only POST preview has no invented idempotency header or write/retry recommendation", () => {
  const value = native({operationKind: "analysis", path: "/commerce/native/delivery-calendars/{resource_id}/preview.json"});
  const result = parsed(value);
  assert.equal(value.readOnly, true);
  assert.equal(value.aiSafety.readOnly, true);
  assert.equal(result.idempotency, "none");
  assert.equal(result.readOnly, true);
  assert.equal(result.aiIdempotencyRequired, false);
  assert(!result.parameters.some(parameter => parameter.name === "Idempotency-Key"));
  assert.doesNotThrow(() => validateOperationAuthority(value, result));
});

test("Native exact query parameters replace heuristics and preserve format/required flags", () => {
  const queryParameters = [
    {name: "date", in: "query", required: true, schema: {type: "string", format: "date"}},
    {name: "cursor", in: "query", required: false, schema: {type: "string"}},
  ];
  const value = native({method: "GET", queryParameters, parameters: [
    {name: "limit", in: "query", required: false, type: "integer"},
    {name: "offset", in: "query", required: false, type: "integer"},
    {name: "resource_id", in: "path", required: true, type: "string"},
  ]});
  const result = parsed(value);
  assert.deepEqual(result.parameters.filter(parameter => parameter.in === "query").map(parameter => parameter.name), ["cursor", "date"]);
  const date = result.parameters.find(parameter => parameter.name === "date");
  assert.equal(date.required, true);
  assert.equal(date.format, "date");
  assert.equal(result.parameters.find(parameter => parameter.name === "cursor").required, false);
  assert.deepEqual(result.nativeQueryParameters, queryParameters);
  assert.doesNotThrow(() => validateOperationAuthority(value, result));
  const noQuery = native({parameters: [{name: "limit", in: "query", type: "integer"}]});
  assert.equal(parsed(noQuery).parameters.filter(parameter => parameter.in === "query").length, 0);
});

test("Native display text keeps scopes/permissions/query and read-only facts distinct", () => {
  const value = native();
  assert.deepEqual(value.contractNotes, operationContractNotes(value));
  assert(value.contractNotes.includes("Token scopes: admin:write OR (settings:write AND products:write)"));
  assert(value.contractNotes.includes("Native permissions (all): settings:manage AND products:manage"));
  assert(value.contractNotes.includes("Read-only; Idempotency-Key not required"));
  assert(value.contractNotes.includes("Native query parameters: none"));
  assert.equal(scopeRequirementText(operation({requiredScopes: ["admin:read", "orders:read"]})), "admin:read OR orders:read");
});

test("flat Native catalog query descriptors retain the same optional datetime contract as raw schema descriptors", () => {
  const queryParameters = [{name: "from", in: "query", required: false, type: "string", format: "date-time",
    description: "Native window start defaults to the current instant."}];
  const value = native({method: "GET", queryParameters});
  const result = parsed(value);
  assert.deepEqual(value.queryParameters, queryParameters);
  const parameter = result.parameters.find(parameter => parameter.in === "query");
  assert.equal(parameter.required, false);
  assert.equal(parameter.format, "date-time");
  assert.deepEqual(result.nativeQueryParameters, queryParameters);
  assert.doesNotThrow(() => validateOperationAuthority(value, result));
});

test("validator rejects flattened Native groups, lost permissions, read-only drift and invented headers", () => {
  const value = native();
  const flattened = parsed(value); flattened.scopeAlternatives = [["admin:write"], ["settings:write"], ["products:write"]];
  assert.throws(() => validateOperationAuthority(value, flattened), /OR-of-AND/);
  const permissions = parsed(value); permissions.nativePermissions.pop();
  assert.throws(() => validateOperationAuthority(value, permissions), /Native permissions differ/);
  const readonly = parsed(value); readonly.aiReadOnly = false;
  assert.throws(() => validateOperationAuthority(value, readonly), /Read-only semantics differ/);
  const header = parsed(value); header.parameters.push({in: "header", name: "Idempotency-Key", required: true});
  assert.throws(() => validateOperationAuthority(value, header), /must not invent/);
});

test("validator rejects extra or mistyped Native query parameters and required write headers cannot disappear", () => {
  const value = native({method: "GET", queryParameters: [{name: "date", in: "query", required: true, schema: {type: "string", format: "date"}}]});
  const extra = parsed(value); extra.parameters.push({name: "limit", in: "query", required: false, type: "integer"});
  assert.throws(() => validateOperationAuthority(value, extra), /parameter set differs/);
  const format = parsed(value); format.parameters.find(parameter => parameter.name === "date").format = "date-time";
  assert.throws(() => validateOperationAuthority(value, format), /syntax differs/);
  const write = native({readOnly: false, idempotencyRequired: true, requiredHeaders: [{name: "Idempotency-Key", required: true}]});
  const result = parsed(write);
  assert.doesNotThrow(() => validateOperationAuthority(write, result));
  result.parameters = result.parameters.filter(parameter => parameter.name !== "Idempotency-Key");
  assert.throws(() => validateOperationAuthority(write, result), /Required Idempotency-Key header missing/);
});

test("Native optional metadata never changes planned501 availability and malformed groups fail generation", () => {
  const value = native({implemented: false}), result = parsed(value);
  assert.deepEqual(successes(result), []);
  assert.equal(validateOperationResponses(value, result).kind, "planned501");
  assert.doesNotThrow(() => validateOperationAuthority(value, result));
  for (const groups of [[], ["settings:write"], [[]], [[""]]]) {
    assert.throws(() => native({requiredScopeAlternatives: groups}), /Invalid Native scope alternatives/);
  }
});
