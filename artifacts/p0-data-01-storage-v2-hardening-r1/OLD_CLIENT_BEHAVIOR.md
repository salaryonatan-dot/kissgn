# Old Client Behaviour (Codex SV2-08)

## Finding
The legacy engine (`createRemoteEntriesMutator`) parsed a V2 node's frozen `_v` as if it
were the live collection; when the requested value equalled the frozen value it aborted
as a no-op and reported idempotent success although the live rows differed. The server
cannot deny a write the client never sends.

## Change
`parseEntriesNode` classifies ANY node carrying V2 structure (`schemaVersion`, `rows` or
`generation` present) as `{malformed:true, reason:"storage_v2_node"}` — before it ever
looks at `_v`. The legacy engine turns that into `blocked / storage_mode_mismatch`
(detail `storage_v2_node`) and writes nothing; `describeSaveOutcome` maps it to a
"refresh and retry" message rather than the generic catch-all. There is no code path in
the current client that infers success from `_v` once a node is V2.

Scope note: this closes the finding for every client running this code. A client still
running an OLDER cached build has no such refusal by construction; its changed writes are
denied by Rules (`V2-X01`) and its no-op-looking writes never reach the server. That
residual (old build, value coincidentally equal to the frozen snapshot, false "already
applied" in that old build's UI) is a rollout/version-fence concern recorded in
KNOWN_LIMITATIONS.md, not a persisted-state defect.

## Proof
`[H9]` unit ×2: five V2-shaped nodes classified `storage_v2_node`; legacy `{_v}` still
parses; the legacy engine returns `blocked/storage_mode_mismatch` for both the
no-op-looking write (request equals frozen `_v`) and a changed write, node untouched;
operator text present.
`V2-H10` emulator (case A/B: frozen `_v` equals the request and equals the current rows by
construction): `blocked/storage_mode_mismatch` ×2, node byte-identical; case C: every V2
case in the matrix operates on V2 state and succeeds normally. `V2-L01`: a legacy business
still reads and writes exactly as before.

Result: **PASS** (OLD_CLIENT_FALSE_SUCCESS).
