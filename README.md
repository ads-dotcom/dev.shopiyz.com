# Shopiyz Developer Docs

Static Scalar/OpenAPI documentation preview for Shopiyz.

Live site: https://dev.shopiyz.com/

## Publish without GitHub Actions

This project is intentionally build-free. GitHub Pages can serve it directly from the `main` branch root:

1. Open repository settings.
2. Go to Pages.
3. Select "Deploy from a branch".
4. Select branch `main` and folder `/`.

Cloudflare Pages can also connect to this repository with:

- Build command: empty
- Build output directory: `/`

## Files

- `index.html` renders the Scalar documentation page.
- `openapi/shopiyz-api.v1.yaml` is a placeholder OpenAPI document.
- `CNAME` binds GitHub Pages to `dev.shopiyz.com`.
