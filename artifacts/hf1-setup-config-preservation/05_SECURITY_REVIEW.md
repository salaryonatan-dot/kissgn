# 05 — Security Review (corrected in R1 — Codex HF1-F3)

The original HF-1 text described the wizard's config authorization loosely as "owner / super_owner, or manager with `biz_access`" and did not distinguish the two different config nodes. The corrected, path-by-path statement follows. `database.rules.json` is **not** changed by HF-1 or R1.

## The actual Setup Wizard node: `tenants/{tenantId}/biz:{bizId}:config`
It is a business-prefixed key directly under `tenants/{tenantId}` and is governed by the **`$dataKey`** branch (the `$dataKey.matches(/^biz:[^:]+:config$/)` arm), not by the literal `config` child:

| Operation | Current Rules for `biz:{bizId}:config` |
|---|---|
| read | authenticated **and** tenant member (`members/{uid} === true`) **and** (role `owner` / `super_owner` **or** `biz_access/{bizId}/{uid} === true`) |
| write | authenticated **and** (role `owner` / `super_owner` **or** (role `manager` **and** `biz_access/{bizId}/{uid} === true`)) |

So `biz_access` is enforced for a manager on the wizard's config write, owner / super_owner bypass it, and read additionally requires membership. An RTDB transaction needs both read and write: a role record without the matching membership could pass the write expression but cannot run the transaction — that inconsistent account state fails closed (typed save failure, no fallback write).

## The separate literal node: `tenants/{tenantId}/config`
A different, non-business-prefixed node with its own explicit rule (read: tenant member; write: tenant member or owner / super_owner / manager; `_v` string < 4096). It does **not** consult `biz_access`. It is not the Setup Wizard's node and its rule must not be cited for `biz:{bizId}:config`; conversely the business-prefixed rule must not be generalised to it. HF-1 / R1 neither read nor write it. (Codex HF1-F3 cited this literal rule for the wizard path; the contract's path analysis — reproduced above — is the accurate one.)

## R1 questions
| Question | Finding |
|---|---|
| New path? | No. The config transaction addresses the exact node the old blind `set` wrote (`tenants/{tenantId}/biz:{bizId}:config`); the later writes address the same `app/business`, `biz:{bizId}:suppliers`, `biz:{bizId}:fixed` nodes. |
| New capability? | No. A transaction reads and writes the same node; authorised, internally consistent wizard principals already hold both. The node keeps the `{_v: string}` envelope (plus any sibling it already had). |
| Rules change | **No** (`RULES_CHANGE_REQUIRED: NO`). |
| Destination binding | Every write uses the explicit-tenant transport (`mutateFor` / `setFor`) with the tenant and keys taken once from the captured `{tenantId, bizId, gen}`; the mutable-tenant `get` / `set` are no longer used on the edit path, so a tenant switch cannot retarget a write. |
| Failure behaviour | Permission denied, missing membership, revoked `biz_access`, read / network failure, retry exhaustion, abort or `committed:false` ⇒ terminal save failure, no later write, no fallback. Client checks are not authorization. |
| `biz_access`, `members`, roles, secrets | Untouched. No grant, no mutation, no credential. |
| Data exposure in logs | Failures log only a stage and a typed reason; raw config content is never logged. |
