# 01 — Reproduction (before any runtime change)

## Method
`test/dashboard/setup-config-preservation.test.mjs` executes the **production text** of `index.html` (extracted by unique anchor + brace matching, evaluated in `node:vm`):
- `SetupWizard` `finish` (builds the wizard `cfg` and calls `onComplete`),
- the edit-mode `<SetupWizard onComplete={…}>` handler (the one carrying `// EDIT existing business — do NOT create new bizId`),
- `saveBusinessConfig`, EmployeesScreen `saveEmp` / `removeEmp`, petty-cash `saveCats`.
Storage is an in-memory model of `window.storage` with the production envelope semantics (`{_v: string}`; `get` throws `"not found"` for an absent node).

The suite was written first and run against the unmodified base `05bf5a59` (`index.html` blob `b9c5f2205c70604899717b508c07d7f5212602dc`).

## Result at the base: 4 pass / 19 fail
| Test | Base result | Failure (excerpt) |
|---|---|---|
| 1 edit name preserves employees | FAIL | `employees must survive a wizard edit — actual undefined` |
| 2 edit rent/royalty preserves petty-cash categories | FAIL | `pettyCashCategories` undefined |
| 3 edit targets preserves employees / unknown target keys | FAIL | `owner_note` target key and `employees` lost |
| 4 employees / petty-cash writers after a wizard edit | FAIL | state after the wizard edit has no employees |
| 5 absent optional fields stay absent | FAIL | `lat must remain absent` (wizard wrote `lat: null`) |
| 6 no key deleted | FAIL | `key employees was deleted` |
| 7 unknown/future keys survive | FAIL | lost |
| 8 nested objects survive | FAIL | lost |
| 9 × 5 malformed stored config | FAIL | the malformed node was **overwritten** (`app-businesses`, `config`, … written) |
| 9b failed read | FAIL | wrote blindly |
| 9c selection change during the save | FAIL | wrote |
| 12 first business (`bizId === tenantId`) | FAIL | no read of the stored config; data lost |
| helper tests (3) | FAIL | helper block absent |
| 10 idempotent, 11 create path, 11b never-stored config, owned-lists written | PASS | (behaviour that must not change) |

Root cause: `SetupWizard.finish` builds `cfg` from scratch with 11 keys (`index.html` base :3978-3994) and the edit `onComplete` (base :5915-5930) does `setBusinessConfig(cfg)` + `window.storage.set("biz:{bizId}:config", JSON.stringify(cfg), true)` — a whole-document replacement. Other screens store their own keys in the same document (`employees` :7843/:7846, `pettyCashCategories` :8066, legacy `oref_areas`/`custom_oref_areas`, `shiftChecklists`), so every wizard edit deleted them.
