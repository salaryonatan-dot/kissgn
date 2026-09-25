# OLD CLIENT PROOF — OPTION B (CTO D-CT-1)

No potentially mutating legacy write is ever attempted against the real canary business, and no sacrificial Production business is created. `tools/` contains no legacy-shape write (asserted: the transport's only PUT targets `storage_v2_control/{t}/{b}/phase`).

Production evidence assembled by `probe-legacy-denial --execute --confirm <token> --token-file <ordinary member ID token>`:
1. **Deployed Rules fingerprint** — REST `/.settings/rules.json` text hashed as a git blob (`byte`) or compared structurally against the repo file that hashes to `approved.rulesBlob` (`structural`); mismatch ⇒ STOP.
2. **Client-authenticated read** of the entries node with the ordinary token (READABLE proves the token is valid and Rules-evaluated as a member; DENIED/other ⇒ INCONCLUSIVE, exit 13, nothing else attempted).
3. **Client-authenticated same-value PUT of `control/phase`** — harmless if it were accepted (same value), expected DENIED under the approved Rules (`control_record_client_write_denied` EXPECTED; ACCEPTED ⇒ STOP).
4. Node/control digests before and after the probe are compared (`probe_changed_data` STOP).
5. **References** recorded in the report: emulator fence matrix VF-03/04/10/18/19/26, parity 708, guard mutations 26, historical page HP-03/04, and CT-E10 — the Rules-evaluated denial of every legacy transport shape (whole-node `{_v}`, `_v` child set, `_v` delete, node delete, multipath, node CAS returning `{_v}`) under quiesced/held/v2_active, plus the positive control (legacy business accepts) and intruder control (denied) that prove the requests were Rules-evaluated and not admin.
6. Monitoring: `monitor` carries `oldClientWriteSucceeded` (STOP if > 0) and the frozen `_v` sha per cycle.

Emulator note (measured 2026-09-25, encoded in the transport): the RTDB emulator treats `Authorization: Bearer <any JWT>` as admin, so emulator probes use `?auth=<token>`; production uses the Bearer header. The report records `transportForm`. Scope statement in every report: the probe proves denial for the shape sent against the DEPLOYED Rules; universal old-shape denial rests on the fingerprint plus the referenced evidence.
