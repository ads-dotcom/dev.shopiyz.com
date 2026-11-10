import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
// JSON is valid YAML 1.2. The portal distributes the runtime builder's exact document.
const text = read("openapi/shopiyz-storefront-api.yaml");
const spec = JSON.parse(text);
for (const relative of ["openapi/shopiyz-storefront-api.v1.yaml", "public/openapi/shopiyz-storefront-api.yaml", "public/openapi/shopiyz-storefront-api.v1.yaml"]) {
  assert.equal(read(relative), text, `Contract copy drift: ${relative}`);
}
if (process.env.SHOPIYZ_APP_REPO) {
  const canonical = JSON.parse(fs.readFileSync(path.join(process.env.SHOPIYZ_APP_REPO, "docs/api/storefront-openapi.yaml"), "utf8"));
  assert.deepEqual(spec, canonical, "Portal contract differs from the application's reviewed runtime contract.");
}
assert.equal(spec.openapi, "3.1.0");
assert.equal(spec.info.title, "Shopiyz Storefront API");
assert(spec.servers.some((server) => server.url === "/api/storefront/v1"));
const resolveReference = (reference) => {
  assert(reference.startsWith("#/"), `Unexpected external schema reference: ${reference}`);
  return reference.slice(2).split("/").reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
};
const visit = (value) => {
  if (!value || typeof value !== "object") return;
  if (value.$ref) assert(resolveReference(value.$ref), `Unresolved reference: ${value.$ref}`);
  for (const child of Object.values(value)) visit(child);
};
visit(spec);
const html = read("public/storefront.html");
assert.equal(read("storefront.html"), html);
const ids = new Set();
let count = 0;
for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!["get", "post", "put", "patch", "delete", "head"].includes(method)) continue;
    assert(operation.operationId && !ids.has(operation.operationId), `Missing or duplicate operationId: ${route}`);
    ids.add(operation.operationId);
    assert(Object.keys(operation.responses || {}).some((status) => /^2\d\d$/.test(status)) || operation["x-shopiyz-availability"]?.startsWith("blocked_"), `No success response or explicit availability block: ${method} ${route}`);
    assert(Object.hasOwn(operation, "x-shopiyz-auth"), `Missing auth policy: ${route}`);
    for (const [, name] of route.matchAll(/\{([^}]+)\}/g)) {
      assert(operation.parameters?.some((parameter) => parameter.name === name && parameter.in === "path" && parameter.required), `Missing path parameter: ${route} ${name}`);
    }
    assert(html.includes(`/api/storefront/v1${route}`), `Undocumented HTML route: ${route}`);
    count++;
  }
}
assert(count > 0);
assert.equal((html.match(/data-operation-card data-search-text=/g) || []).length, count, "HTML method coverage differs from OpenAPI.");
for (const navigation of ['href="/admin">Admin API</a>', 'class="active" href="/storefront">Storefront API</a>', 'href="/openapi">OpenAPI</a>']) assert(html.includes(navigation));
assert(html.includes("applySearch") && html.includes("data-resource-toggle"));
assert(html.includes("overflow-wrap:anywhere") && html.includes("minmax(0,1fr)"));
console.log(`Storefront documentation matches the runtime contract (${count} operations, ${Object.keys(spec.paths).length} paths).`);
