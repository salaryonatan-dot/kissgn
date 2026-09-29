# 02 — Field Ownership of `biz:{bizId}:config`

> **Superseded in part by R1** (successor of `95d20d86`): the edit save is now an atomic config transaction plus a destination-bound write sequence — see `08_R1_REMEDIATION.md`, `09_R1_FINDINGS_MAP.md`, `10_R1_TEST_MATRIX_AND_RESULTS.md`, `11_R1_RELEASE_MANIFEST_DELTA.md`. The original candidate is not a deployable identity.

Derived from every writer and reader in the repository (`index.html`, `src/**`, `api/**`, `lib/**`). "Owned" = written by the Setup Wizard's `cfg` literal (`finish`, :3978-3994 at the base). The ownership list is asserted by a test against the real `finish` output.

| Field | Owned by Setup Wizard | Writer(s) | Readers | Write behaviour after HF-1 | Preserve on edit |
|---|---|---|---|---|---|
| `businessName` | **YES** | wizard | header, business list, server `dailyBuilder` / snapshot | set to wizard value | — |
| `rentType` | **YES** | wizard | `calcMetrics`, fixed screens, snapshot, Financial Core compat | set | — |
| `rentPct` | **YES** | wizard (0 when `rentType` = fixed) | same | set (explicit owned value) | — |
| `rentFixed` | **YES** | wizard (0 when `rentType` = pct) | same | set | — |
| `hasRoyalty` | **YES** | wizard | same | set | — |
| `royaltyPct` | **YES** | wizard (0 when no royalty) | same | set | — |
| `targets.salesGrowthPct` / `.foodCostPct` / `.laborCostPct` | **YES** (these three sub-keys only) | wizard | wizard prefill (other readers use top-level keys — defect T1, C1/B2) | set per sub-key | other `targets.*` sub-keys: **YES** |
| `lat`, `lon` | **YES** | wizard (location step) | `dailyBuilder` (weather) | set when picked or already stored; an untouched empty value is not added (matches the original comment "Only included when actually picked") | — |
| `region_ids`, `subregion_ids` | **YES** | wizard | `dailyBuilder` Oref resolution | set when non-empty or already stored; an explicit clear of a stored list is written as `[]` | — |
| `employees` | **NO** | EmployeesScreen `saveEmp` / `removeEmp` (spread of current config) | labor everywhere, snapshot, Financial Core | untouched | **YES** |
| `pettyCashCategories` | **NO** | petty-cash `saveCats` (spread) | petty-cash screen | untouched | **YES** |
| `oref_areas` (legacy flat list) | **NO** (legacy writer no longer exists) | none today | `dailyBuilder` fallback | untouched | **YES** |
| `custom_oref_areas` | **NO** | none in `index.html` (server/region taxonomy input) | `dailyBuilder` | untouched | **YES** |
| `shiftChecklists` (legacy) | **NO** | none today | checklist template auto-conversion source (:9330) | untouched | **YES** |
| `targetSales` / `targetFoodCost` / `targetLabor` | **NO** (no writer) | none | server snapshot | untouched | **YES** |
| any other / unknown / future key | **NO** | — | — | untouched | **YES** |

Ambiguities (resolved by preserving): `oref_areas`, `custom_oref_areas`, `shiftChecklists` have no current client writer; ownership is unclear, so they are preserved. `targets` is partly owned: only the three wizard sub-keys are written; unknown sub-keys are preserved.

Other documents written by the wizard edit (`app-businesses` name update, `biz:{bizId}:suppliers`, `biz:{bizId}:fixed`) are lists the wizard loads and edits in full (steps 3–4) — owned whole, unchanged by HF-1.
