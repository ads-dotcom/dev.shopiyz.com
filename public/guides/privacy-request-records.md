# Privacy request records

The Admin API `POST /privacy/requests.json` and `/privacy/customer_requests.json`
create a request record. Their `approve`, `reject` and `complete` actions update
that record's review status. Creation returns the exact new request identity,
including when another request for the same customer has a later timestamp.

These calls return `execution_mode: "record_only"`, `applied: false` and:

```json
{
  "privacy_fulfillment": {
    "scope": "this_call",
    "export_generated": false,
    "data_erased": false
  }
}
```

This describes the current call and does not rewrite the fulfillment history of
an existing request. A successful status update does not generate a data export
or erase customer data. The existing Native customer data-package workflow is
separate. This metadata also accompanies replayed successful Admin API replies;
replay does not execute another status update or data operation.

Approval and rejection leave an absent `completed_at` absent. Completion sets it
once; an existing completion timestamp is retained. Historical timestamps are
not migrated or cleared by this change. Existing status names, aliases, scopes,
idempotency rules and token-bound store selection are preserved.
