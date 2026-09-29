# 05 — Security Review

| Question | Finding |
|---|---|
| New write path? | No. Same `window.storage.set("biz:{bizId}:config", …, true)` call on the same key, by the same UI action. |
| New write capability? | No. The Rules already let the writer replace the whole `_v` document (owner / super_owner, or manager with `biz_access`). HF-1 only changes the content to "stored + owned edits". |
| Could a user persist fields they cannot write? | No. Preserved content comes from a read of the same node the user is about to write, and the Rules validate the whole document on write exactly as before. There is no field-level Rule to bypass (the document is one opaque `_v` string). |
| Could a user read data they could not read before? | No. The new read is `biz:{bizId}:config`, which the same UI already reads live via `sub()` for the selected business (`members` + owner/super_owner or `biz_access`). A principal that can write but not read (none in the current Rules) would get a read error ⇒ **fail-closed**, nothing written. |
| Tenant / business scoping | Unchanged: the key is built from the currently selected `bizId` under `tenants/{currentTenant}` by the storage layer. `captureSelectionCtx()` / `isSelectionLive()` abort the save if the tenant/business selection changes during the read, so a merged document is never written to another business. |
| Role checks, `biz_access`, `members` | Untouched. No Rules file changed. No role, membership or access mutation. |
| Failure behaviour | Stricter than before: read error or malformed stored document ⇒ no write (previously a blind overwrite). |
| Injection / prototype pollution | Merge copies only 11 fixed owned keys and 3 fixed `targets` sub-keys; stored JSON is only spread into a fresh object and serialised again; no dynamic key from input is assigned. |
| Secrets / Production | None read, none changed. No Production access. |

Conflict with write authorization: **none found** — preserving unknown fields does not require any permission the writer did not already have.
