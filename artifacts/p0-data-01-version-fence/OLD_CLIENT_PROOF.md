# OLD CLIENT PROOF — mandatory, on the real RTDB emulator (`test/emulator/storage-v2-version-fence.mjs`)

"Old client" = every build whose entries lane can only produce legacy-shaped results. Its transport shapes, all exercised with ordinary member auth (owner AND manager):
whole-node `set({_v})` · node CAS returning `{_v}` (the production legacy engine `createRemoteEntriesMutator`, R10 code, run against a live listener as a real page does) · child `set(_v)` · child `remove(_v)` · whole-node `remove()` · multipath `update` touching `_v`.

| case | scenario | server result |
|---|---|---|
| VF-01 / VF-02 | no record; explicit `legacy` record | legacy CAS/set **allowed** (manager, owner; viewer denied as before) — legacy compatibility intact |
| VF-03 | `quiesced`, legacy node | **all 6 shapes DENIED**, node byte-identical |
| VF-04 | `v2_active`, V2 node | **all 6 shapes DENIED**, frozen `_v` intact |
| VF-09 | one legacy business, old + compatible client side by side through legacy → quiesced → conversion → v2_active | legacy: both write · quiesced: both denied · v2_active: old denied (engine + 6 shapes), compatible commits |
| VF-13 | business A quiesced/active | old client still writes B and another tenant; A denied |
| VF-18 | V2 node | `_v` set/remove/update/multipath-remove denied; **negative control**: the pre-fence core Rules (`47f7f888`) loaded through the settings endpoint ALLOW the `_v` delete |
| VF-19 / VF-20 | malformed record (15 shapes) / phase missing | **denied**, incl. legacy creation and V2 init on an absent node; whole-record absence ⇒ legacy allowed |
| VF-24 / VF-25 | `recovery_hold` | denied; resume restores; no legacy path |
| **VF-26 old open tab** | old page opens on a legacy business BEFORE any policy (live `value` listener, hydrated legacy array, one successful write); operator `initializeLegacy → quiesce`; old page writes again → **`failed` PERMISSION_DENIED**, 6 raw shapes denied, server still holds its last committed value; operator converts through the fenced Admin lane and `activateV2`; old page's listener now sees the V2 node; its legacy write and every raw shape (incl. `_v` delete) → **DENIED**; authoritative row and frozen `_v` unchanged | **DENIED after quiesced, DENIED after v2_active** |

Negative control / accepted residual (documented in `KNOWN_LIMITATIONS.md`): the old page's DISPLAY is not protected — after activation its generic reader sees a node shape it does not understand. Every write it can emit is denied on the server, so authoritative data is safe; the operational answer is the reload banner the compatible build shows and the release cadence.

Spoofing (VF-06): a V2-shaped result carrying `clientVersion:"9.9.9"`, `storageProtocol:2`, `releaseId`, `capability:"v2"` is denied on a legacy business, on an absent business without activation and under quiesced; the identical write is allowed only under `v2_active` + `allowV2Initialization=true` — shape × phase decide, labels never do.

Stale generation with a capable client (VF-07): the client refuses before any transaction (`generation_retired`), and a forced raw row write with the retired epoch is denied by Rules.
