# Banner and slider authoring

Banner and slider authoring is a native Theme V2 capability. Use the Studio API
for the selected store, installation, immutable release and template. The legacy
Admin API extension-settings endpoint remains available for compatibility with
saved merchant settings.

`GET /admin/api/v1/apps/banner-slider-manager/settings.json` returns
`settings_source: "defaults"` when no extension row exists, and
`settings_source: "saved_extension"` when a row exists. Default slides are examples;
they are not saved, published or connected to the active theme. The existing
`app.installed`, `app.enabled` and `app.updated_at` values retain their meanings.

Its `authoring` object identifies `mode: "studio"`, marks the returned extension
settings as legacy and reports `active_theme_delivery: "not_verified"`. This
endpoint does not inspect the active Studio publication. Saved legacy settings,
an enabled extension or an installed app do not establish active theme delivery.
Installing or enabling the legacy extension is not the Studio authoring flow.

At `https://superadmin.shopiyz.com/api/studio/v1`, use:

1. `GET /workspace` and `GET /contract` to read the exact selected installation,
   release, schema, section identifiers and defaults.
2. `GET /templates/{template}/design` to read its current document and revisions.
3. `PUT /templates/{template}/draft` to save a complete schema-valid document with
   the required revision checks.
4. `POST /templates/{template}/publish` to publish through the existing gates.
5. `GET /templates/{template}/delivery` to verify the actual published delivery.

Studio credentials are separate from Admin API credentials. A Studio token is
bound to the exact store, installation and immutable release; cookie clients must
provide that selection explicitly. Use the Studio OpenAPI contract for request
bodies and revision requirements. No Legacy Admin API setting grants Studio
access, billing consent or publication authority.
