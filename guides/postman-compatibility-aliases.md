# Preserved Postman compatibility routes

This reference covers ten request templates retained in the curated Postman
collection. They have handwritten Admin Worker handlers; most are outside the
generated public OpenAPI catalog. They do not add catalog operations or replace
the canonical Native contracts. Paths below are relative to the store's own
`/admin/api/v1` origin. Use a store-owned Admin token; `admin:read` and
`admin:write` are the corresponding broad read/write scopes. Resource ownership,
Native state and any narrower operation permissions still apply.

Every write below requires the original `Idempotency-Key` (8–180 characters).
Keep the same token, method, path and body after an uncertain response. These
compatibility wrappers do not all commit their outer HTTP response receipt in
the same transaction as the resource or R2 write. A timeout is not proof that
nothing happened; reconcile the resource before repeating an uncertain effect.

| Method and path | Required input and behavior | Canonical guidance |
| --- | --- | --- |
| `DELETE /orders/{order_id}.json` | Existing deletable order and nonnegative `expected_revision` (query/body), `expectedRevision` (body), or numeric `If-Match`; conflicting forms are rejected. Native deletion guards apply. | Use the order revision from a current read. This is deletion, not cancellation or refund. |
| `POST /orders/{order_id}/returns.json` | Direct fields or `return` wrapper. Explicit `items`/`line_items` entries identify `line_item_id` or `lineItemId` and quantity; omitted items select all currently eligible fulfilled, unreturned units under Native rules. | Prefer `POST /orders/{order_id}/commands.json` with `action:create_return` and an explicit current revision/selection. Creating a return does not refund payment. |
| `POST /returns/{return_id}/{action}.json` | `action` is only `approve`, `reject` or `receive`; direct fields or `return` wrapper. They request Native `in_progress`, `cancelled` or `returned` respectively. `receive` defaults `restock:true`; Native receipt/inspection/state guards may reject it. | Prefer the Native order commands `inspect_return` and `process_return`; a status label cannot bypass required inspection. |
| `POST /orders/{order_id}/invoices.json` | Direct fields or `invoice` wrapper; exactly one `invoice_url` (credential-free public HTTPS PDF URL) or `pdf_base64` is required. `url`, `base64` and `attachment` are accepted aliases. Base64 PDFs require private R2, `%PDF-` content and at most 10 MB. Optional stable `id` identifies the attachment. | Attaches an invoice document. It does not issue a fiscal invoice, render a document, send mail or prove external delivery. |
| `GET /invoices/{invoice_id}.json` | Existing invoice owned by the token's store; returns its saved typed attachment metadata. | Order reads also expose saved invoice metadata. |
| `GET /invoices/{invoice_id}/file` | Store-owned invoice with an attached private R2 object; the same Admin authentication remains required. A URL-only attachment has no local PDF to stream. | Streams the protected stored object; it does not fetch the external invoice URL. |
| `GET /files/staged_uploads/{upload_id}.json` | Existing store-owned staged-upload record and configured media bucket; reports the actual object/status/expiry. | Use the ID returned by the staged-upload creation flow. Staging does not publish a product/file reference. |
| `PUT /files/staged_uploads/{upload_id}.json` | Raw file body, suitable `Content-Type`, original write key and the issued `upload_token` query parameter before expiry; at most 25 MB. Admin authentication is also required. An already-ready object is read back as the existing result. | Use the exact upload URL/token issued by the creation flow. Do not substitute a supplier URL or assume shopper publication. |
| `DELETE /files/staged_uploads/{upload_id}.json` | Existing store-owned staged upload and configured media bucket; removes the staged object and marks its runtime record `deleted`. | Reconcile the staged ID after an uncertain response; this is not deletion of a published catalog asset. |
| `POST /webhooks/{webhook_id}/rotate_secret.json` | Existing store-owned webhook and original write key; returns the rotated secret through the authenticated response. No caller-selected secret is accepted. | Store the returned secret privately. Rotation does not prove callback delivery; inspect webhook delivery records separately. |

The collection's product update request uses `PUT /products/{product_id}.json`.
The current product handler does not accept `PATCH` on that route.

Source review: Core `facec4632612000084447caa3a4160be65691b70`,
`workers/admin-api/src/index.ts` (`canAccessAdminApi`,
`findAdminApiRequiredOperation` gateway check, `runRawAdminApiEndpoint`,
`runCriticalOrderWriteEndpoint`, `runCatalogExtensionEndpoint`, `rotateWebhookSecret` and
`attachAdminOrderInvoice`); return eligibility/state is enforced by
`functions/_lib/orders.ts`. The registry lookup and twelve isolated authenticated
HTTP requests (including all three return actions) reached handler validation
without 501/405 rejection. Those missing-resource/invalid-body checks establish
route reachability, not successful business execution, Development acceptance
or deployment of this source to a customer store. The store's actual deployed
runtime and returned result remain authoritative.
