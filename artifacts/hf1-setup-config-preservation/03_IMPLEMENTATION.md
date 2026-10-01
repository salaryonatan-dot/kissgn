# 03 — Implementation

> **Superseded in part by R1** (successor of `95d20d86`): the edit save is now an atomic config transaction plus a destination-bound write sequence — see `08_R1_REMEDIATION.md`, `09_R1_FINDINGS_MAP.md`, `10_R1_TEST_MATRIX_AND_RESULTS.md`, `11_R1_RELEASE_MANIFEST_DELTA.md`. The original candidate is not a deployable identity.

## Contract
`newConfig = existingStoredConfig + (wizard-owned keys, as the wizard produced them)`. Unrelated keys are carried over unchanged (same JSON values). No key is ever deleted. No business rule is added.

## Changes (`index.html`)
1. **Helper block** (after `window.MarjinVat`, :1128-1173) — `window.MarjinConfigMerge`:
   - `SETUP_WIZARD_OWNED_KEYS` (11 keys), `SETUP_WIZARD_TARGET_KEYS` (3), location keys as optional;
   - `parseStoredBusinessConfig(stored)` → `{ok:true, config:null}` (absent) | `{ok:true, config}` (JSON object) | `{ok:false, reason}` (non-string, unparseable, not an object);
   - `mergeSetupWizardConfig(existing, wizardCfg)` — pure; copies only owned keys from the wizard; `targets` merged per owned sub-key; untouched empty location not added; throws on a non-object existing config.
2. **Edit-mode `onComplete`** (:5961-5988): parameter renamed `cfg` → `wizardCfg`; before any state change or write it
   - captures the selection (`captureSelectionCtx`),
   - reads the CURRENT stored config (`window.storage.get("biz:{bizId}:config", true)`); `"not found"` ⇒ nothing stored; any other read error ⇒ `alert` + **no write**, wizard stays open,
   - aborts if the selection changed during the read,
   - decodes; malformed ⇒ `alert` + **no write** (never replaces a document it cannot read),
   - `const cfg = mergeSetupWizardConfig(decoded.config, wizardCfg)` — the remaining handler lines (state update, `app-businesses`, config/suppliers/fixed writes, close) are **unchanged** and now use the merged `cfg`.

Unchanged by design: `SetupWizard` itself, the create-new-business path (`completeSetup` always uses a fresh `biz_${Date.now()}` id — nothing stored to preserve), `saveBusinessConfig`, Employees / petty-cash writers (they already spread the current config), the storage layer, Rules.

## Guard compatibility
- No added line contains `storage.set`, `persist(`, `migrat…`, `_rtdbSet`, `set(ref`, `remove(ref` or `entries =` (S0 VAT-invariant added-line rule) — the write line is byte-identical; only the meaning of `cfg` changed.
- P0 pinned write blocks (entries lifecycle) are untouched.

## Behaviour changes visible to a user
- Settings edits no longer delete employees / petty-cash categories / other settings (the fix).
- If the stored config is corrupt or cannot be read, the save is refused with a Hebrew message instead of silently replacing it.
- An untouched empty location is no longer written as `lat: null` into a config that never had one.
