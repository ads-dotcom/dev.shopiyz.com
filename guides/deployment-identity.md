# Admin API deployment identity

`GET /admin/api/v1/stores.json` returns `identity.environment` and
`identity.source_sha`. `GET /admin/api/v1/stores/{store_id}/context.json` returns
the same fields in `store_context`; the selected ID must match the token's store.
The existing same-store `/assistant/context/switch-store.json` response uses the
same metadata and still cannot switch an Admin token to another store.

`source_sha` is the 40-character lowercase Core source binding on the
serving worker with a validated format, or `null` when that binding is absent or malformed. `environment`
is the publisher's explicit `PLATFORM_ENVIRONMENT` binding, or `null`. Neither
value comes from client headers or a hostname. Older Native workers can have a
valid source binding but no environment binding; do not infer the environment
from the store's display name or treat an absent value as production.

This identity describes the worker serving the request. It does not certify
that a newer shared source has been distributed to that store, that all APIs
have Native executors, or that external stock authority is active.

There is no generic atomic expected-source header for all Admin API mutations.
Use each operation's documented Native revision preconditions and idempotency
rules. Source discovery does not replace a resource revision check or guarantee
that deployment selection cannot change between requests.
