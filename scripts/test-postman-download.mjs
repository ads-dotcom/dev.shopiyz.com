import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const app = process.env.SHOPIYZ_APP_REPO;
assert(app, 'Set SHOPIYZ_APP_REPO to the reviewed application source.');
const sourceFile = path.join(app, 'docs/api/Shopiyz-Admin-Storefront.postman_collection.json');
const sourceBytes = fs.readFileSync(sourceFile);
const collection = JSON.parse(sourceBytes);
const native = JSON.parse(fs.readFileSync(path.join(app, 'src/lib/adminApiNativeOperationContracts.json'), 'utf8'));
const parse = spawnSync(process.env.PYTHON || '/usr/bin/python3', ['-c',
  'import json,sys,yaml; print(json.dumps([yaml.load(open(file), Loader=yaml.CSafeLoader) for file in sys.argv[1:]]))',
  path.join(root, 'openapi/shopiyz-api.yaml'),
  path.join(root, 'openapi/shopiyz-storefront-api.yaml'),
  path.join(root, 'openapi/shopiyz-account-v2.json'),
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
assert.equal(parse.status, 0, parse.stderr);
const [admin, storefront, account] = JSON.parse(parse.stdout);

function requests(items) {
  return items.flatMap(item => item.item ? requests(item.item) : [item.request]);
}

function canonical(value) {
  return value.replace(/^\{\{[^}]+\}\}/, '').split('?')[0]
    .replace('/admin/api/{{version}}', '/admin/api/v1')
    .replace(/\{\{[^}]+\}\}|\{[^}]+\}/g, '{}');
}

const all = requests(collection.item);
const keys = all.map(request => `${request.method} ${canonical(request.url.raw)}`);
const documentedMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options']);
const workerSource = fs.readFileSync(path.join(app, 'workers/admin-api/src/index.ts'), 'utf8');
// These preserved, handwritten handlers are outside the generated catalog.
// Keep this boundary explicit rather than treating them as generated operations.
const legacyHandlerChecks = new Map([
  ['DELETE /admin/api/v1/orders/{}.json', 'if (orderDeleteMatch && request.method === "DELETE")'],
  ['POST /admin/api/v1/orders/{}/returns.json', 'if (orderReturnMatch && request.method === "POST")'],
  ['POST /admin/api/v1/returns/{}/{}.json', 'if (returnActionMatch && request.method === "POST")'],
  ['POST /admin/api/v1/orders/{}/invoices.json', 'if (orderInvoiceMatch && request.method === "POST")'],
  ['GET /admin/api/v1/invoices/{}.json', 'if (invoiceReadMatch && request.method === "GET")'],
  ['GET /admin/api/v1/invoices/{}/file', 'const runRawAdminApiEndpoint = async'],
  ['GET /admin/api/v1/files/staged_uploads/{}.json', 'const stagedUploadMatch = path.match('],
  ['PUT /admin/api/v1/files/staged_uploads/{}.json', 'const stagedUploadMatch = path.match('],
  ['DELETE /admin/api/v1/files/staged_uploads/{}.json', 'const stagedUploadMatch = path.match('],
  ['POST /admin/api/v1/webhooks/{}/rotate_secret.json', 'if (method === "POST") return rotateWebhookSecret('],
]);

function contractKeys(spec, serverPrefix = '') {
  return Object.entries(spec.paths).flatMap(([route, item]) => Object.keys(item)
    .filter(method => documentedMethods.has(method))
    .map(method => `${method.toUpperCase()} ${canonical(serverPrefix + route)}`));
}

test('download and public mirror match the exact reviewed Core collection hash', () => {
  for (const prefix of ['', 'public/']) {
    const bytes = fs.readFileSync(path.join(root, prefix, 'postman/shopiyz-api.postman_collection.json'));
    assert.deepEqual(bytes, sourceBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(sourceBytes).digest('hex'));
  }
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.equal(all.length, 316);
});

test('all 69 Native, 107 Storefront and 71 Account methods map exactly once', () => {
  const nativeKeys = Object.keys(native).map(key => {
    const separator = key.indexOf(' ');
    return `${key.slice(0, separator)} ${canonical('/admin/api/v1' + key.slice(separator + 1))}`;
  });
  const storefrontKeys = contractKeys(storefront, '/api/storefront/v1');
  const accountKeys = contractKeys(account);
  assert.equal(nativeKeys.length, 69);
  assert.equal(storefrontKeys.length, 107);
  assert.equal(accountKeys.length, 71);
  for (const key of [...nativeKeys, ...storefrontKeys, ...accountKeys]) {
    assert.equal(keys.filter(actual => actual === key).length, 1, key);
  }
  assert.equal(new Set(keys).size, keys.length, 'Duplicate method/resource requests are ambiguous.');
});

test('selected requests use catalog methods or explicit preserved handwritten handlers', () => {
  const publicKeys = new Set([
    ...contractKeys(admin, '/admin/api/v1'),
    ...contractKeys(storefront, '/api/storefront/v1'),
    ...contractKeys(account),
  ]);
  const variables = new Map(collection.variable.map(variable => [variable.key, variable.value]));
  let handwritten = 0;
  for (const request of all) {
    const key = `${request.method} ${canonical(request.url.raw)}`;
    if (!publicKeys.has(key)) {
      const sourceCheck = legacyHandlerChecks.get(key);
      assert(sourceCheck && workerSource.includes(sourceCheck), key);
      handwritten += 1;
    }
    for (const match of JSON.stringify(request).matchAll(/\{\{([^}]+)\}\}/g)) {
      assert(variables.has(match[1]), `Undefined variable ${match[1]}`);
    }
  }
  assert.equal(handwritten, 10);
  for (const [name, value] of variables) {
    if (/token|secret|password|credential|cookie/i.test(name)) assert.equal(value, '', `Do not publish credentials in ${name}.`);
  }
});

test('Native read-only analysis requests omit write keys and actual writes retain them', () => {
  let analyses = 0;
  for (const [key, contract] of Object.entries(native)) {
    const separator = key.indexOf(' ');
    const method = key.slice(0, separator), route = key.slice(separator + 1);
    const operation = admin.paths[route][method.toLowerCase()];
    const request = all.find(item => `${item.method} ${canonical(item.url.raw)}` === `${method} ${canonical('/admin/api/v1' + route)}`);
    const hasKey = request.header.some(header => header.key.toLowerCase() === 'idempotency-key' && !header.disabled);
    if (operation['x-idempotency'] === 'required') assert(hasKey, key);
    if (method === 'POST' && operation['x-shopiyz-read-only']) {
      assert.equal(hasKey, false, key);
      analyses += 1;
    }
    if (contract.idempotencyRequired === false) assert.equal(hasKey, false, key);
  }
  assert.equal(analyses, 3);
  // Reporting uses its separate reviewed contract, outside the 56 Native map.
  for (const route of ['/reports/{report_id}/run.json', '/reports/{report_id}/export.json']) {
    const operation = admin.paths[route].post;
    assert.equal(operation['x-idempotency'], 'none');
    assert.equal(operation['x-shopiyz-read-only'], true);
    const request = all.find(item => `${item.method} ${canonical(item.url.raw)}` === `POST ${canonical('/admin/api/v1' + route)}`);
    assert(request, route);
    assert.equal(request.header.some(header => header.key.toLowerCase() === 'idempotency-key' && !header.disabled), false, route);
  }
});

test('download is visible and guide-relative schema attachments preserve source bytes', () => {
  for (const prefix of ['', 'public/']) {
    const html = fs.readFileSync(path.join(root, prefix, 'openapi/index.html'), 'utf8');
    assert(html.includes('href="/postman/shopiyz-api.postman_collection.json" download'));
    assert(html.includes('316 seçili istek'));
    assert(html.includes('href="/guides/postman-compatibility-aliases.md"'));
    for (const name of ['storefront-account-v2-openapi.yaml', 'customer-segments-native-schemas.json']) {
      assert.deepEqual(fs.readFileSync(path.join(root, prefix, 'guides', name)), fs.readFileSync(path.join(app, 'docs/api', name)));
    }
  }
  const guide = fs.readFileSync(path.join(root, 'guides/postman-compatibility-aliases.md'));
  assert.deepEqual(fs.readFileSync(path.join(root, 'public/guides/postman-compatibility-aliases.md')), guide);
  assert.equal(guide.toString().split('\n').filter(line => /^\| `(GET|POST|PUT|DELETE) /.test(line)).length, 10);
  assert(guide.toString().includes('not successful business execution'));
});
