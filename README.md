# Shopiyz Developer Docs

Static developer documentation preview for Shopiyz.

Live site: https://dev.shopiyz.com/

## Publish without GitHub Actions

This project is intentionally build-free. GitHub Pages can serve it directly from the `main` branch root:

1. Open repository settings.
2. Go to Pages.
3. Select "Deploy from a branch".
4. Select branch `main` and folder `/`.

Cloudflare Pages can also serve this repository with:

- Build command: empty
- Build output directory: `/`
- Production domain: `dev.shopiyz.com`

## Files

- `index.html` renders the Admin/Storefront welcome page.
- `admin.html` renders the Admin API documentation page at `/admin`.
- `storefront.html` renders the versioned Storefront API documentation page.
- `openapi/index.html` presents both OpenAPI contracts together.
- `openapi/shopiyz-api.yaml` is generated from the live Admin API registry and is the AI/integration source of truth.
- `openapi/shopiyz-storefront-api.yaml` is generated from the Storefront API registry.
- `CNAME` binds GitHub Pages to `dev.shopiyz.com`.

## Storefront documentation sync

Generate the HTML and typed OpenAPI files from the current Development `main` checkout:

```sh
SHOPIYZ_APP_REPO=/absolute/path/to/shopiyz-development node scripts/sync-storefront-api-docs.mjs
SHOPIYZ_APP_REPO=/absolute/path/to/shopiyz-development node scripts/validate-storefront-api-docs.mjs
```

The generated Storefront page uses the canonical `/storefront` route. `/` is the API choice page, `/admin` is the Admin API reference and `/openapi` presents both contracts.

Storefront OpenAPI is the exact output of the application’s `buildStorefrontOpenApi` builder, including reviewed schemas, authorization policies and all registered methods. JSON-formatted `.yaml` downloads are valid YAML 1.2. Generate the application specification before syncing, then validate portal parity against the same application checkout. Each deployed store also serves its own contract at `/api/storefront/v1/openapi.json`.

Admin documentation also uses the reviewed application schemas. Run `SHOPIYZ_APP_REPO=/absolute/path/to/shopiyz-development node scripts/sync-admin-api-docs.mjs`, then the matching `validate-admin-api-docs.mjs` command with the same environment. Generation and schema parity validation require python3 with PyYAML, as used by the application API generators.
