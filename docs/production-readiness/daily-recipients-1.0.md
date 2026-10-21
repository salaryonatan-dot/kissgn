# Daily recipient source — 1.0, owner amendment 2026-10-20 17:31 Asia/Jerusalem

One private SERVER deployment environment variable, `MARJIN_DAILY_RECIPIENTS_JSON`, contains the complete explicit mapping. Its only supported schema is a JSON array of exact `[tenantId, businessId, recipientEmail]` tuples. See `daily-recipients.example.json` (synthetic only). Every tuple has exactly three strings; identities use the existing delivery-key predicates and exact equality. No trimming, coercion, case folding, delimiter concatenation, aliasing, owner inference or default mapping occurs. Duplicate pairs are invalid even if the addresses agree. The complete document is validated before any lookup; one malformed row/duplicate invalidates every mapping. `[]` is a valid empty mapping, making every business ineligible. Unset/empty variable = unavailable. Whitespace is not an empty document.

The existing restricted ASCII single-mailbox syntax, length bounds and placeholder suffix rule apply. Broader Unicode/IDN support is deferred. Matching identities with different case or whitespace are distinct, not aliases; copy the exact approved tenant/business identities. Tenant `:` remains supported; business `:` remains forbidden by the approved delivery identity predicates.

Only the common scheduled/manual resolver reads this variable at server runtime. Nothing reads RTDB dailyRecipientEmail or app/users for recipient eligibility. There is no client field, public configuration API, RTDB config write, migration, owner/first-user fallback or existing-business population. Legacy RTDB fields can remain: their creation/change/removal/corruption cannot grant Daily eligibility. Other business configuration remains the Builder's financial input and must still be valid for its existing contract.

Missing mapping reports `no_recipient`; missing server variable reports `recipient_unavailable`; malformed/duplicate schema reports `recipient_data_invalid`; an invalid address reports `recipient_invalid`. Manual replies are 404/503/422 respectively with fixed operator guidance. Scheduled failures are failed rows and completed_with_failures (500), with no attempt/admission/receipt consumed. No address, full mapping, row contents or parser error is logged or returned. In-app recipient management is deferred to 1.1.

## Operator preparation and activation (instructions only; no live operation performed)

1. Prepare the full JSON privately OUTSIDE the repository, upload tree and browser storage, using existing authorized deployment operations. Do not paste real values into chat, source files, shell command arguments, logs, public/preview configuration or the example. No real values are requested by this change. Retain private controlled custody for rollback; the repository contains only a synthetic template.
2. Validate the private file locally against the actual module on Node 22.22.0. From the exact reviewed checkout, use a private file path in `RECIPIENT_PRIVATE_FILE`; this command prints only a bounded validity result, not the contents:

```sh
node --experimental-strip-types --input-type=module - "$RECIPIENT_PRIVATE_FILE" <<'JS'
import {readFileSync} from 'node:fs';
import {resolveDailyRecipient} from './src/server/dailyRecipientConfig.ts';
process.env.MARJIN_DAILY_RECIPIENTS_JSON = readFileSync(process.argv[2], 'utf8');
const result = resolveDailyRecipient('synthetic-validator-tenant', 'synthetic-validator-business');
if (result.ok || result.code === 'no_recipient') console.log('VALID_SCHEMA — exact business coverage still requires operator review');
else { console.error('INVALID_CONFIGURATION'); process.exitCode = 1; }
JS
```

3. Under the already authorized, correctly scoped Vercel project/environment, store the variable as a private Secret/Sensitive server variable. Use its existing dashboard controls, or the already configured authorized CLI with file stdin, for example `vercel env add MARJIN_DAILY_RECIPIENTS_JSON production --sensitive < "$RECIPIENT_PRIVATE_FILE"` (use the existing update operation if already present). Do not initialize login/linking or change project scope as part of this procedure. No `NEXT_PUBLIC_`, `VITE_`, client-visible prefix or browser export. Environment selection must be explicit; production mapping is not a preview fixture. Do not pull/print the secret to prove its presence. [Vercel environment variables](https://vercel.com/docs/environment-variables).
4. Variable edits apply to a NEW deployment, not existing deployments. Activation requires the separately authorized reviewed code/config deployment and the existing single-policy-version rollout/drain procedure. Both Daily entry paths are in `api/daily-snapshot/run.ts`; old deployment URLs, aliases and in-flight writers still need their established hosted coverage/drain proof. Local evidence proves no hosted activation. No deployment or release permission is granted here. [Vercel environment-variable lifecycle](https://vercel.com/docs/environment-variables).
5. Keep private mapping revisions coordinated with the approved deployment/rollback target. A recipient change does not clear accepted/unknown/in-progress business-date admission, receipt or hold evidence and does not reset retry budgets. Removing a mapping blocks delivery; it does not erase historical delivery evidence. Do not migrate RTDB fields or delete/reset state to activate a new recipient. Existing provider, hosted coverage, release and reconciliation gates remain separate.

## Scope transition

The 17:31 decision supersedes the 14:59 choice of RTDB business config as recipient source and the 1.0 editable settings field/authorization requirement. The old recipient-feature RCP-S/E settings write-authorization/persistence and F2 save/correction gates are historical contracts for preserved f775/955689d, not required UI features on this PBN-based lineage. C1's corrected global URL usage and independent load/execution evidence remain valid at those original identities; the new targeted probe reuses that corrected infrastructure. D1 is not repaired or accepted as a membership model: client-writable recipient evidence is simply not an eligibility source in this 1.0 scope.

The 12:38 explicit eligibility/no-fallback/malformed-evidence/restricted-syntax principles remain mandatory. Legacy DR1-07/08/08b/09 list-selection and user-read-error assertions run literally at PBN as source history; new current SC rows cover the new source's matching, damage, refusal and privacy semantics. Existing manual caller authorization, exact context, Builder, delivery/admission, hold, retry and manual deliverWithoutReceipt contracts remain unchanged. No UC2 work or 1.1 recipient UI implementation is authorized.
