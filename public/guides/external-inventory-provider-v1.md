# External inventory provider: configuration and closed checkout contract

The Admin API exposes Native provider configuration, explicit schema preparation,
bindings and read-only operation status under `/stock_authority`. This source
cohort keeps checkout admission **off**. Preparation, a verified provider or a
binding does not enroll the store or attest that checkout/payment producers are
deployed. Capabilities distinguish configuration/kernel readiness from checkout
participation; publisher registration is pending. An enable request returns
`503 stock_checkout_consumers_not_integrated`.

Use an issued `admin:read` or `admin:write` token for reads and `admin:write` for
writes. The current token creator must still have Native store access and
`settings:manage`; binding operations also require `products:manage`. Requests
use `Idempotency-Key`. Native receipts bind store, creator, operation and complete
request fingerprint; a changed body conflicts. Every replay rechecks current
authority. GET does not initialize schema. Only an authorized explicit prepare
may install the reviewed named schema, and it does not enable admission.

Provider origins come from a deployment-owned, default-empty allowlist. Bearer
credentials are write-only and AES-GCM encrypted with the existing backend
`SHIPPING_CREDENTIAL_ENCRYPTION_KEY`. A missing key or origin policy fails closed.
Discovery returns an opaque configuration revision digest over the encrypted
envelope, never a credential fingerprint, origin, token or encrypted envelope.
Provider verification is durable queued work. Its `202` response states whether
the background consumer is enabled; it does not mean a probe has run. Status GET
does not enqueue work. Browser, theme and checkout rendering never call providers.

The provider protocol is `shopiyz.stock-authority.v1`. Its original required
commands are `reserve`, `pending`, `commit`, `release`, `dispatch` and `return`.
`cancel` additionally requires negotiated `committedCancellation:true`: it refers
to committed, undispatched original units, independently of refunds. Each command
has a retained operation ID, exact request/manifest hashes and pinned generation.
An uncertain response must be reconciled through that original operation. It is
not permission to create a new reservation, repeat a debit, release on a clock,
fulfill an order or infer a failed payment. Mixed-cart compensation remains held
until every participant has an authoritative result. Native financial paid truth
and all-participant inventory completion are separate facts.

Status recovery uses `GET /v1/operations/{encodeURIComponent(operationId)}`
with six explicit query parameters: `protocol`, `storeId`, `providerId`,
`generation`, `requestHash` and `manifestHash`. Authentication remains the
original generation's Bearer credential; no new signing or tenant headers are
introduced. The provider can construct an unknown-operation response from this
visible query context even when the first POST never arrived. Its JSON200
`not_found` reply echoes these identities (generation as a number), the path's
operationId, and `receiptId:null`, `reservationId:null`, `expiresAt:null`,
`lines:[]`. Known operation results must match the retained original identities.
Raw HTTP404 or a missing/mismatched context remains uncertain.

`not_found` is a point-in-time observation, not a promise that an earlier packet
cannot arrive. Native requeues only its original retained command, byte-for-byte
with the same operationId and hashes. It cannot release allocations or invent a
new reservation from that observation. The provider must atomically retain the
operation identity/body/receipt together with its physical stock effect. A late
first POST and a retry return the same receipt and make one stock movement;
a later copy must not recreate a hold after its original release. A changed
body under the same scoped operation identity conflicts.

A confirmed reserve status query returns the **original immutable receipt**,
including its original `reservationId` and `expiresAt`, even after that expiry.
The decoder still requires exact identities, hashes and complete lines. It
accepts a finite historical expiry for a status query; this does not renew a
lease. A direct reserve response must still leave more than 60 seconds. When
the original queried reserve has at most 60 seconds left, Native records its
confirmed historical effect but atomically holds the plan out of payment and
dispatch. An unpaid plan queues an explicit release using that same reservation
and causal receipt, and waits for authoritative release confirmation. A verified
payment remains paid truth under review; it cannot authorize release or a new
reservation. The reserve operation is terminal confirmed and is never requeued
with another identity. A lost release acknowledgement queries that release's
own original ID. Provider expiry is never treated as proof of release, and a
late copy of the reserve must return its historical receipt without recreating
a hold. The provider must not fabricate a new expiry on a status read.

`external_item_ref` is exact opaque UTF-8 text, at most 1,024 bytes, with no
controls or invalid Unicode. Native never interprets it as a SKU, property
grammar, URL or quantity. Lines carry Native `QuantityValue` units and their
accepted unit/scale/policy; no supplier-specific arithmetic or fields are used.

An optional binding `line_attribute_keys` selects at most 16 exact Native line
property names, default `[]`. A nonempty selection requires provider capability
`opaqueLineAttributes:true`. All configured keys must exist on the original
accepted Native checkout line. Native selects only those values; it never falls
back to the cart, customer, contact record or a caller-supplied provider payload.
Names beginning `_`/`$`, reserved object keys and internal, credential, session,
token or contact/customer keys are rejected, including nested object keys.

The selected object is at most 4 KiB UTF-8, depth 4, 256 nodes, and 32 entries per
nested array/object. Values retain their JSON types, Unicode and finite decimal
values without conversion. Unsafe integer values, negative zero, invalid
Unicode, non-JSON objects and cycles fail closed. Money and quantity fields
retain their separate safe-integer validation.

The immutable binding revision retains the selection and its policy hash. A
nonempty accepted provider line adds `attributes` and
`attributePolicy:{keys,hash}`. Both are included in manifest and request digests,
verified reply echo and all reserve/pending/commit/release/cancel/dispatch/return
lineage. Existing obligations use their accepted snapshot, even if later Native
properties or bindings change. Missing attributes/capability fail before a Root,
local hold, provider command or money operation. Empty selections emit neither
extension field and preserve the original v1 wire shape.

Local SQLite/HTTP fixtures prove the kernel and Native V2 adapter behavior,
including immutable source ownership, unknown/lost acknowledgements, atomic
financial evidence and single local debit. These are local integration proofs.
They do not attest live Payments/Checkout producers, complete Native V1 wiring,
alternate stock writers, source/peer witnesses, deployment, store activation or
Development/two-store acceptance. Those gates remain required before opt-in.

Explicit Admin preparation can notify the protected Native publisher with the
original committed preparation operation and request hash, using the existing
site credential. Lost acknowledgements retry that same selector. An acknowledged
pending registration is still `ready: false`; it contains no source/version
attestation and cannot enable checkout. Capability reads perform no remote
registration lookup and report `registered: null`. This internal transport does
not add any supplier protocol header or signature.

The optional Native preparer also installs theme runtime guards when the genuine
theme target projection exists. Selecting different immutable theme code,
removing its target, and rolling back append a permanent store witness generation
floor in the same Native transaction. Content/layout publication alone does not
invalidate compatible code. A failed transaction rolls back both selection and
floor; restoring an older release cannot restore an older witness. These guards
do not issue a new witness or attest complete checkout participation.
