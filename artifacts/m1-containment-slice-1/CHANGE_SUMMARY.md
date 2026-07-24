# Marjin 1.0 Core Hardening - Containment Slice 1

## Summary

This slice closes independently-fixable containment issues without changing forecast formulas, data models, Firebase schemas, production configuration, dependencies, or deployment state.

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

## Explicit Non-Changes

- No forecast formula changes.
- No KPI, VAT, or business-rule formula changes.
- No Firebase/Postgres/RTDB schema migration.
- No data migration.
- No dependency upgrade.
- No production API call, production Firebase access, deploy, push, or merge.

