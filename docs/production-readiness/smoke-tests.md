# Post-Deploy Smoke Tests (Phase 7)

Run with synthetic/test identities in each role. Each row: role · business · action ·
expected · rollback trigger if it fails. "Denied" means Rules/API return PERMISSION_DENIED/403.

## Authentication & isolation
| Role | Business | Action | Expected | Rollback trigger |
|---|---|---|---|---|
| owner | bizA | read/write bizA entries | allow | any deny → Rules rollback (P1) |
| manager (biz_access bizA) | bizA | write config/entries | allow | deny → Rules rollback (P1) |
| shift_manager (biz_access bizA) | bizA | write tasks/logs | allow | deny → Rules rollback (P1) |
| shift_manager | bizA | write checklist_template | **denied** | allow → Rules rollback (P1 escalation) |
| viewer (biz_access bizA) | bizA | read entries/config | allow | deny → Rules rollback (P2) |
| viewer | bizA | write entries | **denied** | allow → Rules rollback (P1) |
| manager (biz_access bizA) | bizB | read/write bizB | **denied** | allow → **P0/P1 cross-business** rollback |
| tenantA user | tenantB | read/write | **denied** | allow → **P0 cross-tenant** rollback |
| user, no biz_access | bizA | read entries | **denied** | allow → Rules rollback (P1) |

## Frontend (authenticated UI)
| Screen | Expected |
|---|---|
| dashboard | loads business metrics for permitted business |
| purchases | supplier purchases render; no cross-business leakage |
| supplier alert navigation | alert → business drill-down stays in-scope |
| revenue entry | entry save via server-mediated path succeeds; delta correct |
| tasks | shift-tier writes succeed for permitted roles |
| checklist | run/template/simple-run save via `/api/admin`; conflict shows 409 message; no blank template for shift_manager |
| forecast | READY business shows forecast; INSUFFICIENT_HISTORY shows insufficient-data |
| insights | renders; hourly/weak-hour-sales question → "hourly POS data not available" |

## API (authenticated)
| Call | Expected |
|---|---|
| `/api/admin` business authorization | biz_access enforced; owner/super implicit |
| parameterized checklist read/write (template-items/runs/simple-runs) | server-mediated only; direct RTDB denied |
| analytics reads | server-mediated; return valid or empty (no legacy node) |
| entry exception create/read/update/delete | server-mediated only |
| stale checklist write | returns **409** `checklist_conflict` |
| unauthorized access (wrong biz/tenant) | 403/denied |

## Rules (direct RTDB, authenticated non-admin)
| Path | Expected |
|---|---|
| `biz:{bizId}:pin` | denied |
| `biz:{bizId}:analytics:daily:{date}` direct | denied |
| `biz:{bizId}:insights:daily:{date}` direct | denied |
| `entry_exceptions/{biz}/{date}` direct | denied |
| unknown `biz:*` suffix | denied |
| cross-tenant `tenants/{otherTid}/...` | denied |
(These mirror the 108-case emulator matrix, which already PASSED on the host.)

## Operational
| Check | Expected |
|---|---|
| emails | no unexpected email outside the normal alerts/whatsapp crons |
| cron mutation | crons run read/compute as designed; no schema mutation |
| analytics regeneration | none triggered by the deploy |
| user mutation | none triggered by the deploy |
