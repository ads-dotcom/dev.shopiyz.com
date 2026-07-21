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
- `CNAME` binds GitHub Pages to `dev.shopiyz.com`.
