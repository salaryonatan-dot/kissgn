# ADMIN-SDK MUTATION INVENTORY — `api/admin.js` and the production modules it reaches

Every Admin-SDK write/delete path (`db.ref(...).set/update/remove/transaction` through `getAdminDb()`), classified. "Authoritative business data" = the Storage V2 / entries domain the fence protects (`tenants/{t}/biz:{b}:entries`, its ledgers such as `entry_exceptions`) and anything whose deletion destroys it.

| # | action / function | writes | class | maintenance gate |
|---|---|---|---|---|
| 1 | `create-client` → `handleCreateClient` | NEW tenant: `tenants/{t}/{app/users, app/business, roles, members, meta, lookup}`, `user_tenants`, `username_index` (409 if username/email exists) | does not touch business authoritative data (creates an empty tenant) | none required |
| 2 | `edit-client` → `handleEditClient` | `tenants/{t}/app/business` (name list), `lookup`, `username_index` | tenant metadata; no entries domain | none required |
| 3 | **`delete-client` → `handleDeleteClient`** | `tenants/{t} = null` (every business's entries, config, ledgers…), `user_tenants/{uid} = null`, `username_index/{u} = null`; Firebase Auth users deleted | **tenant destructive mutation** (Codex F2) | **R1: `tenantMaintenanceHold` before any write; 423 if any business is quiesced / recovery_hold / malformed / unreadable; `storage_v2_control/{t} = null` joins the same atomic update** |
| 4 | `create-user` → `handleCreateUser` | `tenants/{t}/app/users`, roles/members/lookup/biz_access (+ Auth user, email) | user management | none required |
| 5 | `delete-user` → `handleDeleteUser` | roles/members/lookup/username_index/audit, `app/users` | user management | none required |
| 6 | `update-user` → `handleUpdateUser` | `tenants/{t}/users/{uid}`, roles, lookup email, `username_index`, `app/users` | user management | none required |
| 7 | `roles` → `handleRoles` (+ `runGuardedOwnerOp`) | roles/members/audit, `access_meta/owner_guard` transaction, `app/users` | user management | none required |
| 8 | `bootstrap-self` → `handleBootstrapSelf` | roles/members/`user_tenants`/`access_meta/owner_guard` | user management (first owner) | none required |
| 9 | `reset-password`, `resend-invite`, `complete-profile` | Auth password / email; profile fields in `app/users` | user management / email | none required |
| 10 | **`set-entry-exception`, `clear-entry-exception`** → `eeAuthorizeWrite` → `lib/repositories/entryExceptionsRepo.js#runEntryExceptionTxn` (transaction on `tenants/{t}/entry_exceptions/{b}`) | entries-domain ledger | **entries-domain mutation** | **R0: business admission after authorization (423)** — re-verified R1 (AM-H) |
| 11 | `set-checklist-template-items`, `set-checklist-run`, `set-checklist-simple-run` → `lib/repositories/bizDataRepo.js#setBizDocGuarded` (`tenants/{t}/biz:{b}:checklist_*`) | business operational documents (checklists), version-token guarded | business data mutation OUTSIDE the entries domain | not gated — not authoritative entries data; a quiesced cutover concerns entries storage only (documented; see KNOWN_LIMITATIONS) |
| 12 | `list-*`, `get-*` (`readBizDoc`, `readBizDailyRange`, `listEntryExceptions`) | none | reads | — |

Reachable production modules: `lib/repositories/entryExceptionsRepo.js` (item 10, transaction only), `lib/repositories/bizDataRepo.js` (`writeBizDoc` — exported, unused by admin.js write paths; `setBizDocGuarded` item 11), `lib/helpers.js` (`bizAccessSetUpdates` — builds update maps for items 4–7), `lib/verifyToken.js`, `lib/adminSdk.js`, `lib/sendEmail.js` (no DB writes). Other API modules (`create-tenant.js`, `bootstrap-owner.js`, `daily-snapshot`, `analytics`, `proactive`, `agent`, `alerts`) are not reachable from `api/admin.js`; their Admin writes are derived data (snapshots, analytics docs, proactive digests/index) or new-tenant creation, never the entries domain — outside this remediation's scope and unchanged.

**Result: 12 write paths inventoried — 1 tenant-destructive (now gated), 1 entries-domain (gated since R0), 9 user/tenant-metadata management (no authoritative business data), 1 non-entries business-document family (documented, not gated).**
