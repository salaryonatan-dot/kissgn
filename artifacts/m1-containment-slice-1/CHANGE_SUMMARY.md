# Marjin 1.0 Core Hardening - Containment Slice 1

## Summary

This slice closes independently-fixable containment issues without changing forecast formulas, data models, Firebase schemas, production configuration, dependencies, or deployment state.

Independent review verdict after implementation commit `0e22dbf330073a1fe5addcf30dc9dd6ffb58f725`: `REVISE`.

Remediation performed: documentation-only correction of `SECURITY.md` to align it with the current repository architecture and to mark runtime-dependent statements as `UNKNOWN - REQUIRES RUNTIME VERIFICATION`.

Base commit: `0243123027031b068993f7ee69f8e9363f3eed48`

Branch: `codex/m1-containment-slice-1`

Clean worktree: `/Users/yonatan/Documents/marjin/kissgn-m1-containment-slice-1`

## Changes

- Disabled legacy `/api/bootstrap-owner` with a stable HTTP 410 response before auth, Admin SDK, or database access. The active first-owner frontend path uses `/api/admin?action=bootstrap-self`.
- Routed proactive authenticated read actions (`insights`, `digest`, `weekly`) through a pure `lib/proactiveCore.js` that validates query scope and calls canonical `requireBizContext` in read mode before any repository read.
- Fixed the forecast screen runtime `ReferenceError` by passing the selected tenant/business context into `ForecastScreen` and using lexical `tenantId`/`bizId` bindings in the existing forecast call.
- Removed the dead `/api/whatsapp-daily` Vercel cron declaration only. WhatsApp remains disabled; no placeholder route was created.
- Added static and behavioral tests for the disabled endpoint, proactive business-scope checks, cron route existence, declaration parity, and forecast runtime regression.
- Updated narrow stale readiness docs that directly contradicted the new disabled bootstrap route and removed WhatsApp cron.
- Remediation commit corrected `SECURITY.md` documentation only; no API, authorization, forecast, rules, dependency, cron-auth, or runtime behavior changed.

## Documentation Inaccuracies Corrected In Remediation

- Replaced stale Firebase Anonymous Auth claims with the active Firebase Email/Password + Firebase ID token model.
- Marked App Check enforcement and other runtime-only facts as `UNKNOWN - REQUIRES RUNTIME VERIFICATION`.
- Removed active-route claims for nonexistent `/api/beecomm` and `/api/tabit`.
- Documented POS adapters/connectors as dormant, stubbed, diagnostic, or future work, and documented manual entry as current primary business-data ingestion.
- Documented the current role model, including canonical roles and the non-canonical `admin` UI/action concept.
- Corrected RTDB path documentation from obsolete top-level tenant data and top-level `/app-users`/`/app-businesses` claims to the active `tenants/{tenantId}/biz:{bizId}:...` pattern.
- Corrected the active daily analytics path to `tenants/{tenantId}/biz:{bizId}:analytics:daily:{YYYY-MM-DD}`.
- Replaced the false "agent reads only analytics/daily" claim with the current raw-manual-entry recomputation vs built-doc divergence.
- Corrected multi-branch claims: `bizId` is the effective business scope and real multi-branch support is not implemented.
- Replaced the false "no role-change audit" claim with partial role/member audit coverage and the remaining audit gap.
- Aligned active API inventory with the actual `api/` tree and clearly marked disabled 410 endpoints.

## Explicit Non-Changes

- No forecast formula changes.
- No KPI, VAT, or business-rule formula changes.
- No Firebase/Postgres/RTDB schema migration.
- No data migration.
- No dependency upgrade.
- No implementation behavior change in the documentation remediation commit.
- No production API call, production Firebase access, deploy, push, or merge.
