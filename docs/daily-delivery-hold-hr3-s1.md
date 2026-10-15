# HR3 S1 — incomplete local remediation

This successor starts from immutable HR3 checkpoint `fd52603403eb0415d352e12d20842e4f894dea6b`, whose sole parent is HR2 `6aac2683b614d367b5963670d44fa79f31b709c8`. It requires Claude's independent review. It is not ready for release or integration.

## Corrections implemented

The scheduled gate now requires an acknowledged committed finalization. A locally successful transaction callback followed by `committed: false` cannot grant handoff permission. Finalization reclassifies the current audit and binds the admitted intent's generation, business date and observed version to the logical open read. Changed or contradictory evidence leaves the invocation closed and its pending evidence intact. A hold after a successfully completed gate still cannot recall a handoff. Receipt, claim, provider, attempt budget and manual transport code are unchanged.

Six additional deterministic tests exercise first-write loss plus restart, a noncommitted callback, audit corruption between read and finalization, a concurrent hold, intent identity changes and a late acknowledgement. They use an in-memory persistence model; they are not fresh emulator evidence. A late transaction may still commit after timeout; timeout is never treated as cancellation.

## Outstanding seven failures and mutation CONTROL

The HR1/HR2 behavior suites are preserved byte for byte. Seven original test rows still fail: HR-02, HR-07, HR-10, OT-01 and the three HR1-R-01 rows. They demand a release-success path that is unavailable under the approved completeness policy. HR-02 additionally demands the old exact record shape. HR-10 and the second HR1-R-01 row also require the rejected blanket exclusion of never-refused dates. Making them green by restoring that fence or accepting confirmation as completeness would violate the owner's recorded policy.

The original 24-mutant runner uses these same three committed suites. Its CONTROL is therefore red before mutation. It cannot yield valid detection counts. Old range-specific mutation anchors also need an independently reviewed mapping to a future complete exact-date protocol. The narrower inventory mutations do not substitute for the original contract. No original assertion, expected result or guard is weakened to manufacture a green result.

## Exact technical dependency

The route builds its business date in the process and first attempts to persist evidence inside `makeDailyDeliveryGate`. Neither its cron declaration, receipts, held-date markers, nor the tool's operator attestations is an authoritative pre-intent inventory. If the first intent and marker both fail before persistence, process loss leaves exactly the same durable data as a generation with no invocation. The new two-history test compares those bytes and restarts from each snapshot. Hashes and review attestations receive identical inputs; neither can establish completeness.

A successful release requires a supported authoritative durable admission/date inventory upstream of this failure boundary, a generation-bound sealing/high-water boundary, verifiable reconciliation of every admitted invocation/date including unsuccessful gate writes and unknown acknowledgements, and an atomic comparison of the exact sealed inventory/proof/operator confirmation with release. Missing, changed, contradictory or unreadable evidence must refuse. Previously unrecorded historical invocations require that source too; adding another possibly failing write in this route does not recover them. No such source or seal exists in this component. No policy decision is being requested again.

The retained release block is intentional: even an exact reviewed empty inventory returns `inventory_coverage_unverified`. Pending and legacy-uncertain dates remain blocked and are never promoted to proven refusals or silently discarded. No successful release, safe automatic forfeiture, quiescence or manual catch-up is claimed. Seven failures, the original red CONTROL and HR2-R-01 remain open.

## Proposed protection transition

HR3G is evaluated on the literal checkpoint object, preserving its sole-HR2-parent, old pin, edit reconstruction and boundary assertions. HR3S1G binds this successor to that checkpoint, pins the sole changed runtime file across HEAD/index/checkout, reconstructs its exact edits, checks staged and untracked protected paths including ignored, Unicode and newline filenames using NUL-delimited Git output, and proves original tests/records/Rules/route/tool remain checkpoint bytes. Effective candidate overlays and B2G gain only the new emailDelivery pin. Approved tables and publication pins are unchanged. These technical transitions await Claude, as do the implementation changes.

CC2's existing scoped acceptance and the delivered RF2 verdict are preserved. UC2/security remains paused. No sibling candidate is integrated and no combined release acceptance follows.
