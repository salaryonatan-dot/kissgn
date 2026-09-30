# B2 successor — requirement → test

The full ledgers are in the external handoff: `02_GATE_LEDGER_37.md` and `03_SCENARIO_LEDGER_24.md`.

| Requirement | Tests |
|---|---|
| INV-01…14, B2-T01…T16 | `test/finance/b2-snapshot.test.mjs` (the identifier supersession v1→v2 is the only expectation change; B2-T11 was retitled for allocation-eligible days) |
| E-00…E-07 | `test/finance/b2-email.test.mjs` (E-02: the dated revenue line replaces the generic revenue gap count) |
| Closures, timing, missing, zero, rent, partial numerators, ledger states, structure | `test/finance/b2-successor.test.mjs` B2S-01…19 |
| Full goldens (B2-G36) | `test/finance/b2-email-goldens.test.mjs` (10 states + set test) |
| Guards (CD-AT30, B2-G30/G31) | `test/finance/b2-guard-mutations.test.mjs` |
| Emulator (B2-G34) | `test/emulator/server-readers-matrix.mjs` SR-14 (legacy + V2: D-1, R-17 absent/unreadable, structured future and contradicted closures, unreadable ledger) |
| Storage forms | `test/analytics/entries-reader-snapshot.test.mjs` (legacy ≡ V2) |
