# Native credit, gift cards and loyalty reads

These routes use the same Native services as the management panel. They require
the corresponding deployed runtime and installed Native schema. A successful
local test or a published specification does not establish store readiness.

| Route | Token alternatives | Current Native creator permission |
| --- | --- | --- |
| `GET /customers/{customer_id}/store_credit/native.json` | `admin:read`, `admin:write`, `customers:read` or `customers:write` | `customers:manage` |
| `GET /gift_cards/native.json` | `admin:read`, `admin:write`, `products:read` or `products:write` | `products:manage` |
| `GET /gift_cards/{gift_card_id}/native.json` | Same gift-card alternatives | `products:manage` |
| `GET /loyalty/native/settings.json` | `admin:read`, `admin:write`, `settings:read` or `settings:write` | `settings:manage` |

Use the store's own `/admin/api/v1` base URL. The token needs an active linked
Native creator with current membership, role and access to that store. The
adapter checks this authority again before returning the result. Historical
tokens without a linked creator retain their existing compatibility routes;
they cannot impersonate a Native staff member on these new routes.

All four reads bypass the generic response cache and use a Primary D1 session.
They do not install schema, initialize wallets, expire balances, reconcile
orders, change policies or send notifications. Missing Native prerequisites
return 503. Another store's customer or gift-card identity returns 404.

## Customer credit

The `wallet` object retains Native `balanceMinor`, `reservedMinor`,
`availableMinor`, `expiredMinor`, `revision`, `initialized`, `lots`, `history`
and `legacyHistory`. Choose an optional uppercase `currency`; omission uses the
store currency. A balance of 10,000 minor units with 3,000 reserved has 7,000
available. Expired units are separately observable and are not spendable.

The camel-case `*Minor` values and movement/lot `*_minor` values are integer
currency minor units. Historical `legacyHistory.amount` and `balance_after`
retain their stored major-unit meanings. Preserve these separate contracts.
An uninitialized wallet may project an existing legacy balance without writing
an opening movement; `initialized=false` makes that distinction explicit.

The response also shares the panel's `actorId`, validated `expiryTimeZone` and
`permissions.credit|debit|refund` review context. An invalid or unknown store
timezone is null; clients must not invent a timezone for an expiring credit.
These permissions describe the current Native staff member. They do not grant
token scopes, expose financial command endpoints or authorize an order refund.

## Gift cards

The list returns Native `giftCards`, `meta` and per-currency `totals`. Supported
filters are `search`, `status` or `tab`, `balance`, `currency`, `issueMethod`,
`value`, `valueOperator`, `createdFrom`, `createdTo`, `sort`, `limit` and `offset`.
Search and sorting retain Native workspace semantics. Unknown and duplicate
query keys are rejected. Native pagination limits still apply.

Both reads mask `code` to its final four characters. Detail also returns the
validated redemption policy, transaction/comment/event/delivery history,
`historyPage` and `historyHasMore`. Use a nonnegative `page` for history. A
delivery record reports its saved state; reading it does not send a message.
`initialValue`, `balance` and transaction `amount` retain Native major units.

## Loyalty

The settings response is the panel's canonical management projection: policy,
wallet totals, pending reconciliation count, redemption capability, currency and
`pointMinorPerUnit=100`. A read observes current facts without activating policy
or running pending reconciliation. Redemption capability alone is not evidence
that a particular customer or checkout qualifies.

These read routes do not establish Native mutation parity for credit/debit,
gift-card issuance/adjustment/disable or loyalty policy changes. Existing
compatibility mutation behavior remains separately described by discovery.
