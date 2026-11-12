# Admin API free-text search

Product, customer and collection free-text search supports long and multibyte
text without using a length-limited SQL LIKE pattern. Search remains scoped to
the token's store. List, count and pagination use the same resource predicate.
Customer search still includes the customer's saved addresses; product search
still includes the same-store variants and their SKU, barcode and options.

The existing parameter names and normalization are preserved:

- Products: `search` or `q`; wildcard characters are replaced with spaces,
  whitespace is collapsed, and the existing 120-character bound remains.
- Customers: `search`, `q` or `query`; existing wildcard-to-space normalization
  is retained without introducing a new truncation rule.
- Collections and resources using the shared search builder: `search` or `q`,
  with their existing normalization and 120-character bound.

Matching retains the existing SQLite case handling. Search normalization does
not create SQL patterns. Structured filters, scopes, ordering, field selection
and response shapes retain their existing behavior. This change does not add a
new search language or change the separate customer-facing account APIs.
