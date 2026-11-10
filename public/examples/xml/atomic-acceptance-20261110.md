# Atomic XML acceptance samples

These synthetic feeds are for isolated Development acceptance. They contain the same three fixed external IDs, draft products, no images and no credentials. They do not configure or activate a store.

| Feed directory | Expected result |
| --- | --- |
| `baseline` | Complete two-page catalog; prices 101, 202 and 303. |
| `complete` | The same identities; prices 111, 222 and 333. A reader should observe the complete old or complete new result. |
| `checkpoint` | The complete catalog payload and generation remain unchanged; the independent inventory checkpoint advances. |
| `incomplete` | The second page intentionally returns 404. The first page must not partially replace the previously applied catalog. |

Use each directory's `manifest.xml` on `https://dev.shopiyz.com/examples/xml/atomic-acceptance-20261110/`. The response headers declare `X-Catalog-Generation` and `X-Inventory-Checkpoint`. The missing page is intentional.

Create a separate inactive/manual profile and verify that the fixture prefix has no existing products before importing. Capture the three resulting native product IDs; archive only those captured IDs and remove or deactivate that profile after verification. Never use these samples to overwrite an existing feed. Draft samples prove Admin catalog visibility; they do not prove a published Storefront transition.

Admission HTTP 202 is not application proof. Follow the same writer's durable operation until the whole-run atomic receipt reports `result.applied=true`. Retry transient catalog-read 503 responses according to `Retry-After`, preserving the logical operation key. See the [integration guide](/guides/central-management-contract.md) for runtime prerequisites and recovery.
