# Native inventory documents

These read-only endpoints return the transfer and purchase-order documents used
by the inventory panel, from the same shared readers and the token's store:

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/inventory/native/transfers.json` | Native transfers and active locations |
| GET | `/inventory/native/transfers/{document_id}.json` | Transfer, saved lines and events |
| GET | `/inventory/native/purchase_orders.json` | Native purchase orders and active locations |
| GET | `/inventory/native/purchase_orders/{document_id}.json` | Purchase order, saved count or measured lines and events |

Prefix each path with `/admin/api/v1`. Use a linked, active Native token creator
with current access to that store and `products:manage`. Accepted token scope
alternatives are `admin:read`, `admin:write`, `products:read` or `products:write`.
Scopes alone do not replace current staff permissions or store membership.

Lists return `documents`, `locations` and `meta: {offset, limit: 50, total}`.
Only active locations from the selected store are included. Optional `offset`
is an integer from 0 through 100000. The existing gateway rejects larger offsets
with HTTP429. Optional `status` uses these exact saved Native states:

| Documents | States |
| --- | --- |
| Transfers | `draft`, `in_transit`, `partially_received`, `completed`, `cancelled` |
| Purchase orders | `draft`, `ordered`, `closed`, `cancelled` |

Details return `document`, `lines` and `events`. Measured purchase details also
return `measured: true`; preserve their integer `quantity_units`, `received_units`
and `scale`, plus unit and saved profile/policy revisions. These are exact stored
amounts, not integer product stock. Event `details_json` remains saved JSON text.

Duplicate or unknown query parameters are rejected. Detail routes accept no
query parameters. A missing or foreign document returns HTTP404. Missing release
schema returns HTTP503 and is never installed by an API read. Responses are
private and are not served from the generic catalog cache.

The legacy `/stock_transfers` and `/purchase_orders` compatibility records use
different identities and storage. Their IDs do not become Native document IDs.
These endpoints do not create, receive, ship, cancel or replay a document, adjust
stock, activate external inventory authority, send provider requests or publish
catalog changes. Existing panel writes retain their Native workflow.
