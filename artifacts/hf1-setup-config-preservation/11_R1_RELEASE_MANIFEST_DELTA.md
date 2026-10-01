# 11 — R1 release-manifest delta

| Identity | Value |
|---|---|
| P0 approved release candidate (manifest pin) | commit `05bf5a59`, `index.html` blob `b9c5f2205c70604899717b508c07d7f5212602dc` (`artifacts/p0-scheduled-auth-release/06_RELEASE_MANIFEST.md`, unchanged by R1) |
| HF-1 original candidate (superseded, NOT deployable) | commit `95d20d8646736fe1c80c949924fa7875fbda90d2`, tree `c80404c47d2121e286c61f0aaac195384a932257`, `index.html` blob `f200738645653e2cbc6dc2d5dd056c8d82fd1f47` |
| HF-1 R1 successor (this commit) | parent `95d20d86`; `index.html` blob **`1055bedc2e49efa45335247d7255102982444b4a`**; commit SHA and tree are recorded in the external handoff (a commit cannot name its own hash) |

Delta vs the P0 manifest: exactly one runtime file changes — `index.html` (`b9c5f220…` → `1055bedc…`); `api/**`, `lib/**`, `src/**`, `database.rules.json`, `vercel.json`, packages, `tools/**` are byte-identical to `05bf5a59`. Changed non-runtime paths: `test/dashboard/setup-config-preservation.test.mjs`, `artifacts/hf1-setup-config-preservation/**`.

Shipping HF-1 requires a separately reviewed manifest update that re-pins the client blob to the R1 value (and, if combined with the Vercel hardening sibling `947552f6`, a new integration commit per contract 07). This document authorises no deploy, preview, integration or Rules publication.
