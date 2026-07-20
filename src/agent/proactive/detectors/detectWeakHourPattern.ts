// RETIRED — proactive detector: Weak Hour Pattern (Foundation Release).
//
// Removed from the active detector registry in runProactiveJob(). There is no
// valid per-business hourly POS source this release, so the detector can never
// receive trustworthy hourly data. It is not imported or invoked by any active
// planner, agent, cron or endpoint.
//
// The insight-type taxonomy entry "weak_hour_pattern" is retained elsewhere
// (types.ts / prioritization / getTopActiveInsights) only to keep DISPLAY of any
// pre-existing historical insight working — nothing generates new ones.
//
// This file is intentionally left inert and unreferenced (the sandbox filesystem
// forbids file deletion). Restore under a dedicated POS-ingestion release.
//
// See commit: "fix: retire unsupported hourly analytics workflow".

export {};
