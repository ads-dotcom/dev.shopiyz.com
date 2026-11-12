# XML import waiting and recovery

An accepted atomic import is asynchronous. HTTP202 acknowledges the retained
operation; an applied Native completion receipt establishes catalog publication.
Keep the original operation key, token, store, profile and job identities. Poll
the original operation URI after an uncertain response. Do not submit a new
import, reset a failed job or invent a new operation ID to resolve an unknown
outcome. Operation recovery remains bound to the original token.

A retained Engine plan or batch lease is temporary contention. The background
connector returns HTTP503 with `code: "xml_engine_busy"`, `retryable: true` and
`Retry-After: 15`. Sync's existing bounded retry path retains the same operation,
Engine job, cursor, configuration and receipt identity. This does not acknowledge
a catalog write, clear a lease or grant permission to replay a different batch.
Other Engine conflicts retain their existing terminal error behavior.

Read-only API polling may also return HTTP503 with
`SERVICE_TEMPORARILY_UNAVAILABLE`. Existing API families use both error shapes:

```js
const code = body?.error?.code || body?.code;
```

Use a bounded delay before repeating a GET to the same operation URI. Respect
HTTP429 and its retry information. Do not treat an unavailable read as proof of
success or failure, and do not repeat a write merely because its status read
failed. Exhausted reads require reconciliation with the original operation.

Source failures such as an actual missing XML page remain failures. An incomplete
atomic source must retain the previously published catalog. Normal job
cancellation is a separate, authorized command. Before changing the profile,
require the cancellation API's exact own-job acknowledgement, `applied: false`
and `cache_settled: true`; publication cannot be inferred from a queue status.

Atomic staging preparation is also asynchronous. The private Sync callback may
return HTTP200 with `success: true`, `done: false`, `preparing: true`, the exact
unchanged Sync cursor and a zero-scanned/zero-failed batch. This acknowledges a
bounded preparation step only. It never acknowledges the Engine's pending
commands, advances a source cursor or proves catalog publication. Public import
admission remains HTTP202 and publication still requires the same Native
completion receipt.

Preparation creates at most 128 schema objects per step. Its durable progress and
lease are stored with the original run; source and baseline rows are copied in
one transaction after all temporary tables exist, before temporary triggers are
installed. Between steps a 95 second pause lets the existing 90 second Engine lease
expire without clearing it. The same immutable command manifest is verified
again before work resumes. A committed step with a lost response is recovered
from its stored cursor; its DDL and snapshot are not blindly repeated. Existing
configuration, cancellation, schema, inventory and final publication guards
remain in force. Partial preparation never changes the live catalog.
