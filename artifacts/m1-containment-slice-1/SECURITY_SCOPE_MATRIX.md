# Security Scope Matrix

## Endpoint Matrix

| Surface | Scope source | Scope validation | Auth primitive | Allowed roles | Business grant | Reads/writes after change |
|---|---|---|---|---|---|---|
| `OPTIONS /api/bootstrap-owner` | none | none | none | none | none | Ends with 204; no auth, Admin SDK, read, or write. |
| Non-OPTIONS `/api/bootstrap-owner` | ignored | ignored | none | none | none | Always 410 `{ error: "unsupported_action", action: "bootstrap-owner" }`; no auth, Admin SDK, read, or write. |
| `GET /api/proactive/run?action=insights` | query `tenantId`, `bizId` | `extractScope(req, { source: "query" })`; body/query ambiguity fails closed | `requireBizContext(req, { mode: "read" })` | `viewer`, `shift_manager`, `manager`, `owner`, `super_owner` | explicit `biz_access` for scoped roles; owner/super_owner implicit all-business per canonical primitive | Checks tenant existence, then reads top active insights for authorized business only. |
| `GET /api/proactive/run?action=digest` | query `tenantId`, `bizId`, optional `date` | same as above; `date` must be `YYYY-MM-DD` if supplied | same as above | same as above | same as above | Checks tenant existence, then reads daily proactive digest for authorized business only. |
| `GET /api/proactive/run?action=weekly` | query `tenantId`, `bizId` | same as above | same as above | same as above | same as above | Checks tenant existence, then builds weekly summary for authorized business only. |
| `/api/proactive/run` cron/manual branch | unchanged | unchanged | unchanged local branch logic | unchanged | unchanged | Cron/manual behavior was inventoried only; no auth redesign in this slice. |

## Access Outcomes Covered By Tests

- Same-tenant allowed business succeeds after `requireBizContext` and before repository reads.
- Same-tenant disallowed business fails with no repository read.
- Cross-tenant access fails with no repository read.
- Malformed `tenantId` fails before auth and repository reads.
- Malformed `bizId` fails before auth and repository reads.
- Missing auth fails before repository reads.
- Revoked/invalid auth simulated through DI returns redacted 401.
- Repository failures return generic `internal_error` without leaking provider, Firebase, path, or stack details.

## Residual Notes

- This slice preserves the existing `requireBizContext` contract: owner and super_owner receive implicit all-business access; scoped roles require `biz_access`.
- This slice does not migrate legacy permissions or alter role definitions.
