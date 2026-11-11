# Central management API contract

Use each store's own `/admin/api/v1` origin and a token belonging to that store. Store credentials stay on the management server. `GET /stores.json` supplies the resolved `identity.store_id`, token identity, scopes and catalog version; it does not invent a source build revision.

API source support, Development acceptance, customer deployment and per-store configuration are separate states. These additions require the corresponding runtime. An authorized first read of `/orders/changes.json` enables synchronization for that token's store; an authorized native API action initializes API-owned receipt support. Ordinary Native schema startup and unrelated API reads do neither. External XML commands also require the matching XML engine deployment and enrolled external authority. A successful source test is not evidence of a customer deployment.

## Discovery and execution

Read `/api_catalog.json` or `/capabilities.json`. An operation's `implemented` flag means a runtime handler exists. The additive `executionMode` distinguishes audited behavior:

| Value | Meaning |
| --- | --- |
| `native` | The audited handler reads or executes the native service described by its contract. State guards and configuration still apply. |
| `record_only` | The handler stores an operation request or compatibility record. Its successful HTTP response is not evidence that the requested commerce effect happened. |
| `unavailable` | The route is catalogued but blocked as unimplemented. |
| `catalogued` | Execution semantics have not been classified by this audit. |

Top-level carrier purchase/label/void compatibility routes, generic shipment writes, dedicated order-note operation routes, generic `/orders/{order_id}/actions.json` and standalone fulfillment cancellation remain request records. Use the native order command route below for actual carrier creation, private labels and pre-handoff cancellation. Use order PATCH to change `order.note`, or the native `comment` command to append a timeline comment. Native partial fulfillment is `POST /orders/{order_id}/fulfillments.json`; it records shipment quantities and tracking, without purchasing a carrier label. `POST /fulfillments.json` remains unsupported.

Generic `/content/publish_schedules`, `/content/revisions`, `/theme_previews`, `/publishables/...` and the documented compatibility content actions retain their record behavior. Use `/content/workflows/...` for actual approval, immutable revisions and scheduling. These distinctions preserve existing integrations without describing a queued request as a completed action.

Draft creation/completion, order-edit and exchange compatibility requests still
store request records; they do not execute their Native Admin workflows.
`/stock_transfers.json` and `/purchase_orders.json` likewise use compatibility
records, rather than the Native inventory document ledger. Their presence in
the catalog does not establish Native workflow parity. The specific
`DELETE /draft_orders/{draft_order_id}.json` route uses Native deletion: it
releases the draft's reservations and refuses completed or in-flight payment
drafts. Keep the original idempotency key when retrying deletion.

## Order synchronization

Each order line exposes nullable decimal-text `total_price`, `discount_total` and
`tax_total` from its saved `order_line_items` columns. The projection does not
multiply quantity by price, query current catalog prices or distribute order-level
tax/discount totals. `line_accounting.source`, `status` and `field_status` identify
column provenance and availability. Stored zero remains zero; legacy default-zero
columns do not prove an explicit original allocation, so
`historical_allocation_status=not_proven`. These fields alone are not an immutable
invoice snapshot. Existing measured minor-unit values, `total_discount`, tax lines,
discount allocations and opaque line properties retain their existing meanings.


Use `/orders/changes.json` for reliable reconciliation, including deleted orders. It has store-local sequence numbers and minimal change metadata, without customer payloads. Database triggers append events in the same transaction as native order row creation, update and deletion. Notification-only child triggers also cover line properties/file references, fulfillment allocations/tracking, transactions, refunds, invoice files, returns and timeline events; they join the child to its parent using both store and order identity. Upsert duplicates are expected, including internal order lease updates. This is a change notification feed, not immutable historical order snapshots.

The feed sequence is the aggregate-change checkpoint. The order's `revision` remains the native commercial-action compare-and-set value. A direct native child projection edit can keep that revision and the parent's `updated_at` unchanged; child notification triggers never alter a lifecycle fence. Use the sequence feed to discover these changes and refetch the relevant current order/child resources.

1. Read `GET /orders/changes.json?after=0&limit=100`. Save its `high_water` for this traversal.
2. Process `changes` in sequence order. For `kind=upsert`, fetch the current `/orders/{order_id}.json`; a newer deletion can already make that read return 404. For `kind=delete`, remove the local projection.
3. Follow `Link: rel=next`, or use `after=pagination.next_after&through=high_water`. The fixed `through` excludes writes committed after the first page.
4. Persist `checkpoint` only after processing the page successfully. When `has_more=false`, the checkpoint equals the fixed high-water mark.
5. Poll again with `after=<saved checkpoint>` and omit `through` to capture a new upper bound.

The first authorized feed read installs notification triggers and backfills that store's current order identities as upserts in one database transaction. Repeated reads do not reseed the baseline; other stores are enrolled only by their own authorized first read. Deleted orders from before enrollment cannot be reconstructed. Tombstones survive order deletion; deleting a store removes its feed. The feed does not yet prune its history. Consumers can resume within that store's retained sequence range. Legacy native actions continue using their existing mutation columns before and after API receipt enrollment; older receipts without an API-token owner remain unavailable to API recovery reads.

Existing order-list numeric `offset`, `page_info` and `cursor` behavior remains compatible. An optional `GET /orders.json?pagination=keyset&updated_since=<ISO>&limit=100` traverses `(updated_at,id)` through a fixed `snapshot_at`. Follow the returned opaque `next_cursor` as `page_info`, with the same filters. `updatedSince` is an alias; `updated_at_min` is also supported, but use only one lower-bound form. Keyset mode requires `updated_at_asc` if a sort is supplied and rejects offsets. Its `checkpoint` is a timestamp, and `includes_tombstones=false`: use the sequence feed for deletion reconciliation. Timestamp traversal is not a historical snapshot of concurrently edited rows.

## Order commands, revisions and receipts

Order list/detail now include `revision`. Preserve the native `financial_status`, `fulfillment_status` and delivery timestamps separately. `fulfillments[].line_items` contains the actual saved parcel allocations; a partial parcel does not represent every remaining order line. Original addresses, taxes and monetary snapshots retain the existing contract.

Use `expectedRevision` or `expected_revision` in the command body, or numeric `If-Match: "7"`. When multiple forms are supplied, they must agree and identify a nonnegative integer. Tracking updates also enforce this precondition. These are optional on existing update/action routes for compatibility; callers seeking optimistic concurrency should always supply one. Order deletion retains its required precondition and native deletion guards.

Every logical write needs a stable `Idempotency-Key` of 8–180 characters. An authorized retry must keep the same bytes, method, path, token and key. Check the operation's durable receipt or resource-reconciliation requirements after a lost response. Changed payloads return 409. Do not rotate the key merely because an outcome is uncertain.

Generic CRUD creation, including menus and unmanaged pages, has an additional interruption boundary: the tenant resource insert and the outer API-database response receipt are separate transactions. The outer processing lease can expire after 30 seconds. Repeating only the HTTP key is not an exactly-once proof for a create whose generated resource ID was never received. Where creation accepts `id`, choose a stable client resource ID, verify it is initially absent, and reconcile uncertain outcomes with a cache-bypassed GET of that same store/resource and its expected fields. If identity or ownership remains uncertain, do not blindly create again. This limit differs from the durable native lifecycle, content-workflow and XML operation receipts described here.

Read `GET /orders/{order_id}/operations/{operation_key}.json` for durable shared-action status. URL-encode the original key. It returns the action, status, expected/resulting revision, bounded error code and `reconciliation_required`; a successful fulfillment receipt includes its exact `fulfillment_id`. The receipt is limited to the store and the same API token that admitted the action. Receipts from native/internal writers or older actions without recorded API-token ownership return 404. This endpoint covers shared lifecycle actions, rather than generic queued compatibility records or every ordinary field edit.

For composite order PATCH lifecycle actions, the receipt key is `<original-key>:<native-action>`, for example `central-123:cancel` or `central-123:fulfill`. The field update and each lifecycle action are separately guarded; this compound request is not one cross-service transaction.

`completed` proves the durable native action result. `processing`, `failed`, HTTP timeout and 5xx alone do not prove that an external provider did nothing. If `reconciliation_required=true`, retain the operation key and use the existing native reconciliation workflow; do not send a new refund. The Admin API now passes the tenant runtime and original request into the shared provider/refund/cancellation service, preserving its locks, provider evidence and recovery gates.

## Native order commands

`POST /orders/{order_id}/commands.json` is the actual order command adapter. It requires `orders:write` or `admin:write`, `Idempotency-Key` and an order revision precondition. Use `{command:{action,...}}`, or the same fields directly. The whitelist is `create_shipment`, `create_shipping_label`, `cancel_shipment`, `update_tracking`, `update_shipping_address`, `fulfill`, `mark_delivered`, `create_return`, `inspect_return`, `process_return`, `comment`, `cancel`, `archive`, `unarchive`, `hold_fulfillment` and `release_fulfillment_hold`. It excludes payment-state overrides. Customer notifications are unsupported on this adapter; a true notification flag returns 422.

Carrier creation uses the existing verified published connection and configured default package. It returns the durable carrier operation ID, provider reference, native shipment ID and tracking; creation prepares a label and leaves `shipped_at=null` until physical handoff is established. Another active or uncertain carrier shipment blocks a new create key for that order. `cancel_shipment` is restricted to pre-handoff labels; order cancellation after handoff uses the existing guarded `cancel` action with its carrier-cancellation confirmation.

`create_shipping_label` needs the native `shipment_id` owned by the order and uses the existing private R2 label service. Its receipt's `shipping_result.asset` has MIME type, bytes/hash metadata and a signed download URL valid for five minutes. That URL serves protected bytes without a browser cookie and does not expose an R2 object publicly. A successful same-key replay returns the original asset/reference; obtain a new label command when an old download expires.

Return commands expose the actual native cases and inspection quantities. `inspect_return` item deltas are `received`, `sellable`, `quarantine` and `rejected`, keyed by `line_item_id`. Incomplete receipt/inspection cannot be completed by forcing a `process_return` status. Physical receipt does not itself refund money; the existing refund endpoint performs the separately guarded financial operation.

Public financial bookkeeping routes reject Shopiyz-managed provider capture, mark-paid and void operations with `provider_financial_operation_required`; this includes order PATCH, order action aliases, bulk mark-paid and `/payments/{captures,voids,manual_payments}.json`. Managed ownership is established by `payment-*` provider identifiers or native provider session/transaction evidence. `POST /orders.json` also rejects an attempted settled result for a managed provider identifier. Existing order creation does not import lifecycle states; create the order, then use the appropriate bookkeeping/action contract.

Existing manual/bank/COD bookkeeping remains available. A generic external `card`, wallet or marketplace label without managed provider evidence retains its existing bookkeeping behavior; `settlement_source=external` (or `settlementSource`) is an optional explicit declaration. The additive `financial_bookkeeping` result records the derived/declared settlement source and `provider_execution=false`. Native provider invoice/payment-attempt evidence also establishes managed ownership, and an external declaration cannot override it. Provider financial truth continues through actual provider execution and authenticated callback lanes; public token caller identity cannot substitute for provider evidence.

`POST /payments/{captures,manual_payments,voids}.json` records offline/external
transactions without calling a provider or committing inventory. Use the
existing `capture`, `manual_payment` or `void` wrapper, or direct fields.
`order_id`/`orderId`, `payment_method`/`paymentMethod`,
`transaction_id`/`transactionId` and `processed_at`/`processedAt` remain accepted.
Omitted status means `success`; `succeeded` normalizes to `success`, while
`failed`/`failure` normalize to Native `failure`. A `pending` or failed record
does not change financial status or outstanding balance. Successful captures
use the shared Native ledger projection, accept partial remaining amounts and
reject excess amounts, currency mismatch and invalid currency precision.
An imported partial-paid snapshot with no retained successful cash transaction
must reconcile its historical payment ledger first; a new capture cannot replace
an unknown historical amount (`payment_history_reconciliation_required`, 409).
Blended store-credit, gift-card or loyalty tenders use their own Native settlement
flow; this standalone bookkeeping route returns
`payment_tender_reconciliation_required` (409), without consuming those tenders.
Omitted capture amount uses the current outstanding balance. A successful void
requires the Native payment state transition; it does not refund captured cash.
`expected_revision`, `expectedRevision` or numeric `If-Match` is an optional
precondition. The transaction, balance, action revision and token-owned Native
receipt commit together. Recover with the original-key order operation endpoint
above; a lost reply does not authorize a new transaction key.
A completed `offline_capture`, `offline_manual_payment` or `offline_void`
receipt proves the bookkeeping record was saved. Inspect the transaction's
status and returned financial state to determine its financial effect.

## Native count inventory commands

`POST /inventory_levels/set.json` and `/inventory_levels/adjust.json` retain
`variant_id`/`inventory_item_id`, `location_id`, `available`, and
`adjustment`/`delta`. An explicit `adjustment:0` is zero. Count values must be
safe integers; invalid fractions and negative results return structured 422/409
instead of silently rounding or clamping them. Measured quantity profiles still
require their explicit Native exact-unit contract; a decimal count is not a
translation into measured units.

Single writes and the existing inventory bulk-job consumer use the Native stock
ledger. The selected location changes while the variant remains the sum of all
locations. Reserved units, current location state and actual stock authority are
checked in the transaction; external or unknown stock ownership cannot be
overridden with a local write. The existing Native manual fallback to the first
active location is preserved when none is marked default. `reason` and `note`
remain movement metadata. A tenant receipt joins each stock command so a lost
delta acknowledgement can recover with the same token, path, body and key.
Bulk jobs retain independent per-variant results and are not all-or-nothing
across every requested variant.

Count `inventory_quantity` on product/variant creation and variant updates uses
that Native ledger too. This covers standalone and product-scoped variant PUTs,
nested `product.variants`, and the existing inventory-item PATCH/PUT alias
(which retains its `variant` request object). Quantities and conditional
`expected_inventory_quantity` accept non-negative safe integers, including
nonblank numeric strings. Null, booleans, blanks and fractional counts are
rejected before parent or child records change.

A changed aggregate quantity can resolve a location only when exactly one
active Native location exists. Multiple active locations return 409
`inventory_location_required`; use an explicit `inventory_levels` command.
An unchanged quantity is a stock no-op, so a full PUT can still edit scalar
fields under the current quantity/timestamp snapshot. A genuine Native count
with no active location or stock-level rows retains its no-location path. Local stock writes require
current Native ownership, reconciled location totals, and sufficient units for
both checkout and draft holds. A concurrent ownership, hold, level or location
change cannot commit a stale stock update.

All nested variants are prepared before writing. Parent/variant scalar fields,
source-price state, stock movements/levels and the token/path/body/key receipt
commit in one Native batch; new positive tracked stock starts through the same
ledger in that batch. Product CREATE also prepares its existing image INSERTs
before writing and commits them in that initial batch. Retry the original key
after an uncertain acknowledgement. Receipt recovery repeats idempotent collection
synchronization before reading the product.

Existing product gallery-changing PUTs retain their separate workflow and legacy
retry/concurrency semantics; they do not use the new scalar/stock receipt to
bypass a failed gallery step. Keep the existing product/source/gallery
preconditions, and refresh current state after a conflict. This does not make
the entire existing product/media workflow atomic. Measured
profiles continue to require the exact-unit contract. Explicit untracked creation
retains its legacy quantity metadata; it does not allocate location stock or
create a stock movement.

## Native content workflows

`GET /content/workflows/{kind}/{resource_id}.json` supports `kind=page|blog-post`. It returns the publication head, revisions, comments/schedules and current permissions. POST the same route with `ContentWorkflowActionRequest` for `start`, `save-draft`, `submit`, `approve`, `reject`, `schedule-preview`, `schedule`, `cancel-schedule`, `comment`, `restore`, `publish` or `unpublish`.

The token must have content/admin scope and an active `created_by_user_id` with current store membership and native content permissions. Token scope does not replace the native role check. Scheduled publication resolves that publisher's current membership in the actual store account and fences its role, permissions and store access again in the publication transaction; revoked or downgraded authority cannot rely on an older schedule. Preserve `expectedSourceUpdatedAt`, `expectedGeneration` and the exact `revisionId` required by the selected action. Current-revision approval, self-approval restrictions and stale-generation rejection remain native rules. Schedule requests use `publishAt`, or `publishLocal` plus `timezone` where supported.

`GET /content/workflows/{kind}/{resource_id}/revisions/{revision_id}.json?compareTo=<another-id>` returns JSON preview data and an optional field diff. It does not execute supplied HTML. Publish/unpublish can return `cache_followup_status=pending`; publication facts are native, while cache follow-up is separately observable.

Menu writes, native banner settings and supported theme settings accept their documented optional timestamp revision guards. Preserve menu hierarchy on reorder; deleting a page, menu or theme continues to use its existing archive/visibility semantics.

An explicit menu-item `id` identifies that node within its menu and takes precedence over matching URL/resource targets. Two distinct explicit IDs can both use `url="#"` as dropdown parents. Without an explicit ID, the compatible URL/resource upsert behavior remains. Parent IDs must belong to the same menu and form an acyclic tree; `parent_id=null` moves a node to the root.

## Authoritative XML control

An explicitly configured `updatePolicy.preserveExplicitDraftStatus=true` preserves
mapped `draft` and `taslak` product statuses as unpublished drafts in both Native
import lanes. Omitted or false retains the existing status mapping for established
profiles. Unrecognized status strings retain their existing active fallback.

Use `GET /xml/feeds/{feed_id}/state.json` for the real engine configuration, jobs, errors, connection generation, `configurationRevision`, `catalogRevision` and `inventoryCheckpoint`. GET `/xml/feeds/{feed_id}/receipts/{operation_id}.json` returns a durable receipt. All require admin scope; authoritative reads bypass the generic response cache. Configuration reads are redacted: credentials and executable templates are omitted, URL userinfo is removed and query values are replaced with `__SHOPIYZ_REDACTED__`. Read results are not a complete write payload; redaction markers are rejected on writes.

Authoritative create/update/delete/scan/preview/import/schedule commands use `X-Shopiyz-Xml-Authority: external` and `Idempotency-Key`. After creation, also supply `X-Shopiyz-Expected-Xml-Configuration-Revision` from the current engine state. Native camel-case profile inputs and the documented snake-case aliases remain accepted. Create can derive a stable profile ID from its caller/key; enrolled external profiles reject an unqualified mirror mutation.

The routes retain legacy unenrolled mirror CRUD. External failure never silently writes to that mirror. External imports require XML state `protocol.configurationRevision=1` and `protocol.atomicStagingManifest=1`, Sync `/health` capability `xmlApiOperationAdmission=1`, the native staging/schema readiness check and the API cache binding. Mixed old runtimes fail closed before enqueueing. The XML engine's approved additive migration runs through its immutable-source Native release gate; optional Core staging prerequisites initialize only during an authorized external import. Admission returns 202 with `accepted=true`, initially `applied=false`, `visibility=atomic` and a durable `operation`. Admission alone does not prove application; an already reconciled operation can return its applied proof.

The whole-run snapshot and final transaction use a bounded invocation budget of 900 storage calls and at most 900 initialization statements, with a two-million-row snapshot capacity. Source work is split into bounded steps; this is not a fixed product/variant cardinality limit. A readiness/capacity failure returns an explicit error before admission. The source, Sync and native runtimes must all satisfy the protocol before enabling a store.

Media must already exist as ready Shopiyz-managed image objects belonging to the store. The atomic lane verifies those protected tenant object references and rewrites supplier media references to managed URLs; it does not fetch supplier media during storefront reads or publish supplier URLs while media is pending. Finish the normal background media import or Admin upload before retrying an unready-media run.

The atomic lane stages the complete sealed source run before its guarded native catalog transaction. An applied whole-run receipt has `visibility=atomic` and `result.applied=true`; incomplete source pages, changed configuration or catalog conflicts cannot yield that proof. Legacy per-command receipts remain `visibility=incremental`, and the state's integer `catalogRevision`/`inventoryCheckpoint` have `revisionSemantics=applied_commands`. Neither those counters nor a completed planning job proves the atomic commit. Upstream `sourceProof` generation/checkpoint values are separate fields. API imports disable missing-item reconciliation instead of inferring product removal from an incomplete file.

An authorized external XML import initializes its optional Native XML schema prerequisites before durable admission and snapshot creation. Generic authentication, unrelated catalog mutations and read-only readiness inspection do not install these optional tables. Staging and the final merge never create native catalog tables.

After a timeout, read `GET /xml/feeds/{feed_id}/operations/{operation_key}.json` with the original URL-encoded key and the same writer token. States are `admitted`, `preparing`, `staged`, `applied` or `rejected`. `reconciliationPending=true` means queue evidence could not be refreshed and the last observed state is returned. This read never requeues a request, and `replayAuthorized=false` does not authorize a new key for an uncertain operation. Durable native follow-ups retry affected-product stock alerts and cache invalidation after the atomic commit.

Before the live catalog transaction, the native writer establishes a durable per-store API cache barrier. During the critical pending barrier, Admin catalog source reads return 503 with `code=xml_catalog_read_retry` and `Retry-After: 1`. A source response spanning a barrier epoch change is also rejected, preventing an aggregate from combining old product rows with new variants or images. XML state and operation recovery reads remain available. A completed commit publishes its cache epoch; delayed fills from an older epoch cannot become reachable. Definite aborts retain the advanced epoch, and unknown outcomes retain the pending barrier until durable reconciliation. Ordinary cache hits still require no catalog-database read.

## Webhook verification and recovery

Webhook subscriptions and delivery history use `/webhooks.json` and `/webhook_deliveries.json`. The native Webhook Center still needs to be installed and enabled for its native event emission. Failed deliveries have bounded retries/backoff and delivery records; manual retry retains the event identity.

Both senders now add `x-shopiyz-signature-v1`, a base64 HMAC-SHA256 signature over this exact UTF-8 framing, with LF separators and the raw HTTP body last:

```text
v1\n<timestamp>\n<event-id>\n<topic>\n<delivery-id>\n<raw-body>
```

Use values from `x-shopiyz-webhook-timestamp`, `x-shopiyz-event-id`, `x-shopiyz-topic` and `x-shopiyz-delivery-id`, respectively. Verify the signature before accepting those fields, check the signed timestamp against your permitted clock skew/replay window, and persist event-ID deduplication per store/topic. Different delivery attempts may carry the same event ID and fresh delivery IDs/timestamps. The documented replay window is 300 seconds; the receiver enforces it.

The existing `x-shopiyz-hmac-sha256` and native `x-faprika-hmac-sha256` continue to sign the raw body only, with their original compatible headers. Those older signatures do not independently authenticate timestamp headers. Use v1 when relying on the signed timestamp and event/delivery identity.

Webhook dispatch still starts after the commerce transaction; its first delivery insertion is not a transactional event outbox. Use the durable order-change feed to recover missed notifications. This release does not claim exactly-once webhook delivery.

### Source throttling and snapshot expiry

An external XML source's HTTP429 is a durable wait, regardless of its body error code. Engine/Core preserve `Retry-After` seconds or an HTTP date and expose the safe transport code `xml_source_throttled`; Sync retains the same operation/job, frozen manifests, revision and cursor. Waiting is neither successful application nor a failed product and does not consume the generic failure budget. Invalid/missing Retry-After uses30 seconds; a valid unrepresentable deadline requires manual review. A paused job retains that deadline; no callback runs early. No supplier body or credential is exposed.

HTTP410 with source `code`/`error=snapshot_expired` becomes `xml_source_snapshot_expired`; other410 responses become `xml_source_gone`. That old job is terminal and cannot be resumed with its old operation key. Read its existing operation for reconciliation, then explicitly request a new import operation to admit a new manifest. This does not grant retirement authority or alter the Native store/product ownership and atomic publication contract. Engine, Core and Sync must all contain this transport behavior before its deployment is accepted. New public imports require Engine `protocol.xmlSourceWaiting=1` and Sync `/health` capability `xmlSourceWaiting=1`; deploy the Engine and Sync peers before Core. Older callers without the internal wait protocol retain terminal initial-plan failure behavior rather than leaving an active orphan.
# Genel Admin, Storefront, müşteri hesabı ve Studio kapsamı

Admin API mağazanın `/admin/api/v1` yolundadır. Ziyaretçi Storefront v1, özel müşteri hesabı v2 ve Superadmin Studio ayrı yetki sınırlarıdır. Admin tokeni müşteri veya Studio tokeni yerine geçmez. Admin kataloğundaki `relatedApis`, [API aileleri rehberi](https://dev.shopiyz.com/guides/api-families) ve mağazanın `/api/storefront/v2/account/openapi.json` çıktısı bu sözleşmelere yönlendirir.

`implemented` bir kaynak işleyicisinin varlığını belirtir. `executionMode=native` kanonik Native akışı, `record_only` yalnız uyumluluk kaydını, `unavailable` hazır olmayan işlemi belirtir. Mağazanın dağıtılmış sürümü, Native şeması, planı ve etkinliği ayrıca doğrulanır. Kayıt oluşturulması ödeme, stok hareketi, yayın, aktarım veya geri yükleme kanıtı değildir.

## Kanonik raporlar

- `GET /reports.json`, `GET /reports/{report_id}.json`: mevcut panel rapor kataloğu ve gerçek kullanılabilirlik.
- `POST /reports/{report_id}/run.json`: aynı imzalı Reporting servisi, aralık/kapsam ve Native mağaza saat dilimi. `from` dahil, `to` hariçtir. `calendarBasis=store_day_v1` desteklenen günlük raporda mağaza gününü kullanır; aksi varsayılan UTC'dir. Eksik veri başarıya çevrilmez.
- `POST /reports/{report_id}/export.json`: aynı çalıştırma gövdesi ve `format=csv|json`. Yanıt `{export:{filename,content_type,encoding,content,row_count,calendar_basis,truncated}}` şeklinde senkron içeriktir. 512 KiB sınırı aşılırsa 413; sahte job/download_url veya sessiz kesme yoktur. Kapsam ve freshness korunur; CSV formül hücreleri güvenli metindir.
- `POST /reports.json`, `GET /reports/saved.json`, `GET|PUT|DELETE /reports/saved/{saved_report_id}.json`: panelle aynı mağaza kapsamlı kayıtlı raporlar. Yazma gövdesi `{reportId,name,configuration}`; mevcut kayıt formatı `calendarBasis` saklamaz. Yeni yazma protokolü Reporting migration `0004_saved_report_commands.sql` ve aynı sürüm servis ister. Eski servise sessizce yazma yapılmaz.
- `GET /reports/categories.json`, `GET /reports/measured_sales.json`: Native kategori ve ölçülü satış okumaları.

Okuma/çalıştırma/çıktı için `admin:read|admin:write`, kayıtlı rapor yazmaları için `admin:write` gerekir. Tokenin gerçek aktif Native oluşturucusu, güncel üyeliği/mağaza erişimi ve `analytics:view` izni tekrar kontrol edilir. Cookie veya aktör başlığı kimlik seçemez. Bu uçlar ortak yanıt cache'ine girmez. Kayıtlı rapor yazmaları sabit `Idempotency-Key` ile gerçek servis makbuzunu tekrar döndürür; sonraki panel düzenlemesini tekrar uygulayarak ezmez.

## Sipariş ayrıntısı ve taslak komutları

Sipariş listesi/ayrıntısında `include=returns,exchanges,delivery` kanonik Native iade/değişim nesneleri ile kaydedilmiş, doğrulanmış `delivery_plan` döndürür. Değişim satır ekleri yalnız istenirse eklenir. Teslimat planı isteyen listede dönen sayfa en fazla 50 sipariştir. Varsayılan okumaya ek grafik sorgusu eklenmez. İç içe refund/transaction/risk kimliği URL'deki siparişe de ait olmalıdır.

Gerçek Native taslak oluşturma ve revizyonlu güncelleme ayrı komut uçlarıdır:

```text
POST /draft_order_commands.json
  {"command":{"action":"create","draft_order":{...Native camelCase payload...}}}
POST /draft_orders/{draft_order_id}/commands.json
  {"command":{"action":"update","expected_revision":7,"draft_order":{...partial Native payload...}}}
GET /draft_order_commands/{original_operation_key}.json
GET /draft_orders/{draft_order_id}/operations/{original_operation_key}.json
```

POST için aynı `Idempotency-Key` (8–180 karakter), gerçek güncel Native oluşturucu/`orders:manage` ve mağaza/şirket erişimi gerekir. Taslak, rezervasyon ve makbuz aynı Core transaction içindedir. Makbuz özgün komut revizyonunu, dönen taslak ise güncel görünümü ifade edebilir. Yanıt kaybında yeni anahtar üretmeyin; özgün anahtarı okuyun/tekrarlayın. Eski taslak create/update/complete/send_invoice uyumluluk uçları gerçek komut olarak değiştirilmez. Yeni komutlar şu aşamada yalnız create/update kabul eder; çok adımlı complete/send_invoice sonucu uydurulmaz.

## Kampanya, segment ve B2B

Kanonik indirim yazmaları panelin aynı doğrulayıcısını kullanır; ürün/koleksiyon/müşteri hedefleri, kategori uygunluğu, alt sınırlar, kombinasyonlar ve Native config korunur. PATCH'te atlanan alan korunur; sıfır/false/null/boş hedef dizisi açık değişikliktir. Kind/method değişmezdir. Tek fiyat aktivasyonu gerçek yayın/gösterim hazırlığını geçmelidir. DELETE arşivler. Kanonik kurallar ortak response cache'inden okunmaz.

`/customer_segments/native...` uçları gerçek tanım/revizyon, hesaplama işi, generation üyeliği ve aktöre bağlı kitle motorunu kullanır. [Segment rehberi](https://dev.shopiyz.com/guides/customer-segments-native.md) ve tipli OpenAPI; güncel `customers:segments_view/manage/use/export` ayrımı, imzalı cursor ve maskeli üyelik kurallarını açıklar. Eski `/customer_segments...` uyumluluk kayıtları ayrı kalır.

`/b2b/native/catalogs...` okuma ve `operations/preview|apply` mevcut Pro/ayar/Native aktör ve revizyon kapılarını kullanır. Bu adaptör 128 KiB ve en fazla 25 satır `bulk_edit` ile sınırlıdır. Apply sonuçları satır bazında applied/skipped/error olarak okunur; bütün dosya atomik uygulanmış sayılmaz. Ayrı `b2b_` Bearer entegrasyonunun `/companies`, `/orders`, `/events`, `/jobs` sözleşmesi ve `2026-09` sürüm başlığı korunur. Kuyruğa alınan `catalog_import/price_import` işi kaynakta yürütücüsü yokken tamamlanmış fiyat/katalog aktarımı diye sunulmaz.

Genel snapshot/rollback uyumluluk kaydı katalog geri yükleme kanıtı değildir. Sonraki sipariş ve stok hareketlerini koruyan katalog sürüm geri alması, tüm veritabanı geri yüklemesiyle eşdeğer değildir. Native order edit/exchange yazıcılarının ek konum/rezervasyon ve para birimi çalışması tamamlanmadan yeni sınırsız API yeteneği ilan edilmez.

### Native cart discount evaluation

`POST /admin/api/v1/discounts/native/evaluate.json` is a read-only Native checkout evaluation. Use `admin:read` or `admin:write`; an existing linked creator must retain Native discount management and store access. Supply `lines` (1–50 `{variantId,quantity,attributes?}` count lines), optional `discountCodes` (at most5), same-store `customerId`, `shippingCountryCode` and `shippingMethodId`. Prices, product/collection targets, totals and eligibility categories cannot be supplied by the caller. The adapter reads published catalog prices, Native stock/quantity rules, actual persisted active shipping rates and the same discount engine as checkout. It never adopts legacy shipping configuration, creates a checkout/reservation/redemption, persists a preview, or calls a provider. Count lines and two-decimal currencies are supported; rental holds and measured quantities use their canonical checkout workflows.

The response explicitly returns `execution_mode: native`, `evaluated: true`, `applied: false`, `reservation_created: false`, canonical minor-unit lines/shipping and the actual Native `evaluation`. Evaluation aggregate totals are in major currency units; exact line allocations are in minor units. `code_results` distinguishes `applied`, `eligible` and `rejected` candidates within this evaluation. Subsequent checkout must revalidate current prices, stock and eligibility; this response reserves nothing. `Idempotency-Key` is not required for this read-only POST and an old key cannot replay around current creator authorization.

Legacy `/discount_codes/validate.json` and `/checkout/discounts/validate.json` keep their existing `eligible` code-status field for compatibility. The additive `validation_kind: code_status` and `cart_eligibility_evaluated: false` make its scope explicit and link the Native evaluator. Generic persisted discount previews remain `record_only` / `applied: false`; caller `before`/`after` is not a checkout calculation.

### Shipping compatibility estimate

`POST /admin/api/v1/shipping_rates/preview.json` keeps its existing compatibility calculation and returns `execution_mode: record_only`, `applied: false` and `shipping_preview.preview_kind: compatibility_estimate`. It selects API_DB shipping-rate mirror records or synthetic defaults, rather than the persisted Native checkout shipping tables. `native_checkout_quote`, `carrier_quote`, `currency_conversion` and `weight_rules_evaluated` are all `false`: weight is echoed, the requested currency is a label, and no carrier or exchange-rate service is called. Existing country/rate matching, thresholds, tax calculation and delivery-day fallbacks are unchanged. A returned price or delivery range is not a verified checkout or carrier offer.

`shipping_preview.rate_source` identifies the actual selected object as `api_db_mirror`, `synthetic_default` or `fallback_default`; a mirror's caller-supplied `source` field does not determine this label. `defaults_used.country` and `.currency` indicate missing/blank request values replaced by `DE` and `EUR`. `.rate` indicates selection of a synthetic/fallback rate. These three flags do not describe every tax or delivery-day fallback. An explicit country with no matching rate can still retain the existing synthetic default behavior; an explicit currency does not convert the selected price.

For a read-only evaluation using actual Native catalog lines and persisted active shipping rates, use [`POST /admin/api/v1/discounts/native/evaluate.json`](#native-cart-discount-evaluation). Its documented scope remains 1–50 count lines, two-decimal currencies and current linked-creator discount/store permissions; measured and rental checkout use their canonical workflows. The evaluator does not adopt legacy shipping configuration, create a quote/reservation/redemption, or call a carrier. Subsequent checkout revalidates the current state.

### Persisted Native shipping settings

`GET /admin/api/v1/shipping/native/settings.json` reads the same persisted Core profiles, product assignments, zones, rates, packages, delivery settings and rate-coverage readiness as the Native shipping panel. It requires `admin:read` or `admin:write` and the token creator's current Native `settings:manage`, active membership and store access; service tokens without a linked creator receive 403. This exact route bypasses the shared response cache and reads at primary. The business snapshot, currency, redacted published-carrier summary and readiness inputs are materialized in one D1 read transaction.

The response returns `execution_mode: native`, `read_only: true`, `applied: false`, `source: core_persisted_shipping` and `snapshot_hash_kind: read_evidence_only`. `snapshot_hash` identifies this returned snapshot; it is not a configuration revision, ETag or accepted write `If-Match`. Missing required schema returns 503 without installing tables. An existing empty schema returns 200 with `configuration_initialized: false`, explicit `initialization` booleans, empty profiles/packages and `delivery: null`. No defaults are created and eligible legacy `plugins_config.shipping` is not adopted. The panel's existing setup/adoption behavior remains separate. Responses exceeding 2 MiB return 413 rather than a truncated success or fabricated async job.

`settings.readiness` retains Native general-profile persisted-rate coverage semantics. Custom profile assignments remain visible and may affect delivery promises; this read does not claim custom-profile checkout pricing, weight/region/postal pricing or live carrier rates. Only published, verified, non-disabled same-store carrier ids/provider keys/account labels are summarized; credentials and provider configuration are omitted. `native_checkout_quote` and `carrier_quote` are `false`. No provider or supplier network call is made.

This namespace currently exposes only GET. Existing `/shipping_profiles...`, `/shipping_zones...`, `/shipping_rates...` and `/delivery_profiles...` compatibility CRUD continues to use its separate API_DB records. The real legacy `/settings/shipping...` Core JSON bridge also remains separate. Native configuration commands require further shared validation, same-batch current-authority/configuration CAS, revision publication and original-key Core receipts; the panel's multistage mutator is not advertised as such a command.
