# 07 — Review Guide (Codex focused review of HF-1)

> **Superseded in part by R1** (successor of `95d20d86`): the edit save is now an atomic config transaction plus a destination-bound write sequence — see `08_R1_REMEDIATION.md`, `09_R1_FINDINGS_MAP.md`, `10_R1_TEST_MATRIX_AND_RESULTS.md`, `11_R1_RELEASE_MANIFEST_DELTA.md`. The original candidate is not a deployable identity.

Review scope: one commit on `claude/hf1-setup-config-preservation`, parent `05bf5a59`.

1. `git show --stat HEAD` — expect `index.html` (+71/−1), one new test file, this artifacts folder. Nothing else.
2. `index.html` helper block `// ── HF-1: Setup Wizard config preservation` (~:1128): check the owned-key list against the `SetupWizard` `finish` `cfg` literal (~:4016); check `mergeSetupWizardConfig` never deletes and copies only owned keys; check the `targets` sub-merge and the optional location rule.
3. Edit-mode `onComplete` (~:5961): read before write; `"not found"` is the only error treated as "absent"; selection re-check after the await; malformed ⇒ return before any state change or write; the unchanged tail writes the merged `cfg`.
4. Confirm the create path (`completeSetup`) and `SetupWizard` are unchanged.
5. Run `node --test test/dashboard/setup-config-preservation.test.mjs` then the full suite; optionally swap in the base `index.html` blob to see 4/19.
6. Security: doc 05. Ownership decisions: doc 02 (ambiguous fields are preserved).

Points worth a reviewer's judgement:
- Behaviour change: corrupt/unreadable config now blocks the save with a message (fail-closed) instead of overwriting.
- Clearing a stored location list is still possible (writes `[]`); an untouched empty location is not added.
- `targets` sub-keys other than the three wizard targets are preserved; top-level `targetSales` etc. are untouched (T1 alignment belongs to B2/C1, not HF-1).

## HF-2 (`resolveCredit`) — DOCUMENTED, NOT IMPLEMENTED
Observed: the dashboard pending-credits card (~:6931) calls `resolveCredit(cr.id)`, which is defined nowhere (click ⇒ ReferenceError). The list is read live from `biz:{bizId}:credits`, but **no writer of that node exists** anywhere in the repository; the record shape `{id, supplierId, supplierName, date, amount, note}` has no status field. The card says "click to finish after receiving the document".
Ambiguity blocking implementation: (a) delete the record vs mark it resolved (no status field, no history requirement); (b) whether resolving should affect purchases / supplier balances; (c) nothing creates credits today, so the intended lifecycle is undefined. Per the task rule ("If there is any ambiguity about intended credit behavior: DO NOT IMPLEMENT HF-2"), HF-2 needs an owner decision on (a)–(c).

## Release note
HF-1 changes the `index.html` blob (base `b9c5f2205c70604899717b508c07d7f5212602dc`). The approved P0 release candidate `05bf5a59` does not include it; shipping HF-1 with or after P0 needs a manifest update and re-approval of the client blob.
