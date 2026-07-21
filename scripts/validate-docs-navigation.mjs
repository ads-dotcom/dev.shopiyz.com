import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const landing = read("public/index.html");
const admin = read("public/admin.html");
const storefront = read("public/storefront.html");
const openapi = read("public/openapi/index.html");
const redirects = read("public/_redirects");

const checks = [
  [landing.includes("Hangi API ile geliştireceksiniz?"), "Ana karşılama başlığı eksik"],
  [landing.includes('href="/admin"') && landing.includes('href="/storefront"'), "Ana sayfadaki API seçim bağlantıları eksik"],
  [admin.includes('class="active" href="/admin"') && !admin.includes("unversioned</span>"), "Admin URL veya versiyonsuz etiketi düzeltilemedi"],
  [admin.includes('<li>\n              <a class="nav-link active" href="#overview"') && admin.includes('id !== "overview"'), "Admin Overview alt menüsü varsayılan kapalı değil"],
  [storefront.includes('href="/openapi">OpenAPI</a>'), "Storefront OpenAPI bağlantısı merkez sayfaya gitmiyor"],
  [openapi.includes("shopiyz-api.yaml") && openapi.includes("shopiyz-storefront-api.yaml"), "OpenAPI merkezinde iki sözleşme birlikte sunulmuyor"],
  [redirects.includes("/admin /admin.html 200") && redirects.includes("/storefront /storefront.html 200") && redirects.includes("/openapi /openapi/index.html 200"), "Kanonik doküman yönlendirmeleri eksik"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  failures.forEach((message) => console.error(`FAIL: ${message}`));
  process.exit(1);
}

console.log(`Developer docs navigation validation passed (${checks.length} checks).`);
