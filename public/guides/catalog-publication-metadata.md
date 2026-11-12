# Catalog addresses and saved publication metadata

Product and collection reads expose saved Native catalog facts. They do not
publish a resource or calculate whether a particular shopper can see or buy it.

`GET /products.json` and `GET /products/{product_id}.json` include:

- `url`: relative `/products/{encoded_handle}` address, or `null` when no safe
  handle is saved. The existing `handle` then `slug` fallback is preserved.
- `sales_channels`: the saved string array, including an empty array when no
  channel is configured. `null` identifies absent or malformed legacy data; it
  does not silently grant the `online_store` channel.
- Existing `status` and `published_at`: stored publication information. A future
  date remains a future date.

`GET /collections.json` and `GET /collections/{collection_id}.json`, including
the custom/smart collection read aliases, include:

- `url`: relative `/collections/{encoded_handle}` address, or `null` without a
  safe saved slug.
- `status`: the saved collection status, or `null` when unavailable.
- `is_active`: the saved Native active flag as a boolean, or `null` when unknown.
- Existing `published_at`: the saved date without an invented publication date.

These additive fields participate wherever the endpoint already supports
`fields` selection (product reads and collection detail/custom/smart reads).
The original `/collections.json` list retains its existing shape and `publishedAt`
alias, with the additive `published_at` alias for the same saved value; its
existing field-selection behavior is unchanged.
Existing field values, filters and authorization are preserved.
They are read metadata, not new product or collection mutation inputs.

An address alone is not a public visibility or checkout guarantee. Apply the
actual Storefront/checkout rules for publication dates, channels, collection
activation, access policies, domain/theme routing and sale availability. The
legacy compatibility field `published_scope: "web"` is retained; it does not
override the actual saved channel list or imply a public publication receipt.
No tenant domain, locale prefix or supplier URL is guessed by this projection.
