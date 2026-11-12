# Native XML job cancellation

`POST /admin/api/v1/xml/jobs/{job_id}/cancel.json` cancels an exact saved Sync
job belonging to the authenticated store and its XML connector. Use the
`syncJobId` from the accepted import operation, not an Engine job ID.

The store must already use the external XML connection. Send an Admin token
with write scope, `X-Shopiyz-Xml-Authority: external`, an original
`Idempotency-Key`, `Content-Type: application/json` and the body `{}`.
The body is limited to 1,024 UTF-8 bytes. Actor, generation and Engine proof
fields cannot be supplied by the caller.

```http
POST /admin/api/v1/xml/jobs/<sync_job_id>/cancel.json
X-Shopiyz-Access-Token: <admin_token>
X-Shopiyz-Xml-Authority: external
Idempotency-Key: <original_operation_key>
Content-Type: application/json

{}
```

A successful response separates the saved queue acknowledgement (`job`) from
the authoritative catalog outcome (`atomic_cancellation`):

| Field | Meaning |
| --- | --- |
| `state` | `cancelled`, `applied`, `not_atomic`, `not_staged`, `verification_unavailable` or `unverified` |
| `applied: true` | The atomic catalog was already applied. Cancellation does not undo that publication. |
| `applied: false` | A non-applied atomic cancellation was proved and fenced. |
| `applied: null` | The authoritative atomic outcome is not proved. Do not infer rollback or publication. |
| `cache_settled` | The applied or aborted cache outcome was verified. False leaves an unknown publication protected. |

The service authenticates the Engine acknowledgement and checks its exact
store, connection, generation and Sync job identity. An older Engine response
without this proof cannot authorize aborting an unknown catalog. A job from
another store or connector returns404. Repeated cancellation is monotonic;
it does not reset, resume or create an import.

Retain the original key and exact request bytes for an uncertain response.
A changed body with the same key returns409. Replay still checks the current
token and explicit external authority; a saved response does not bypass them.

This contract requires a runtime containing the cancellation adapter. It does
not migrate an existing XML connection or activate checkout stock authority.
