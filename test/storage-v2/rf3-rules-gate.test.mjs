// RF3 — the Rules-owner acceptance RECORD contract (closes the independent RF2 review's RF2-R-03 for the validator; T-RF3-RECORD).
// RF2's proposed RV-G01 iterated only the fields a record HAS, accepted any 64-hex rulesSha256 and validated acceptedAt by shape and
// string order: a record without acceptedBy / recordRef / reviewedBy / reviewRef, with an all-zero digest or dated 2026-02-31 passed.
// test/support/rules-owner-acceptance.mjs is the committed contract a P-2 successor's RV-G01 calls (the package proposal v3 does):
//   RF-11 the record: the eight reviewed fields are REQUIRED strings without placeholders; rulesBlob is a PRESENT git blob and
//         rulesSha256 is the SHA-256 of THOSE bytes; acceptedAt is a real calendar date, not after today; the reviewer is not the
//         acceptor; the scope names the blob; every problem is reported
//   RF-12 the status: this tree carries NO record (publication pending, the release pin unchanged); an invalid record, a valid record
//         with the pin elsewhere and a complete record are told apart — and none of them is ever reported as publication
// Every record below is SYNTHETIC DIAGNOSTIC DATA built inside the test: it names no real person, record or review and is NOT an
// acceptance. The digests are computed here from the repository's own blob bytes; nothing is filled into any fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as X from "../support/canary-fixtures.mjs";
import { gitIn } from "../support/git-context.mjs";
import { DIAGNOSTIC_SENTINEL } from "../support/rf2-rules-gate.mjs";
import { ACCEPTANCE_FIELDS, validateRulesOwnerAcceptance, acceptanceRecordStatus, gitBlobReader, isCalendarDate } from "../support/rules-owner-acceptance.mjs";

const readBlob = gitBlobReader(X.ROOT);
const TODAY = "2026-10-15";                                        // injected: the rows do not depend on the wall clock
const sha = (id) => createHash("sha256").update(readBlob(id)).digest("hex");
const ACCEPTED = X.CANDIDATE_RULES_BLOB;                            // 27887d72 — the identity a P-1 record would name (RF2's proposal)
const synthetic = () => ({
  rulesBlob: ACCEPTED, rulesSha256: sha(ACCEPTED),
  acceptedBy: "SYNTHETIC DIAGNOSTIC acceptor A (not a person, not an acceptance)", acceptedAt: "2026-10-14",
  scope: `SYNTHETIC DIAGNOSTIC scope naming ${ACCEPTED.slice(0, 8)} (not an acceptance)`,
  recordRef: "SYNTHETIC-DIAGNOSTIC-RECORD (no such record exists)",
  reviewedBy: "SYNTHETIC DIAGNOSTIC reviewer B (not a person)", reviewRef: "SYNTHETIC-DIAGNOSTIC-REVIEW (no such review exists)",
});
const judge = (a, today = TODAY) => validateRulesOwnerAcceptance(a, { readBlob, today });
const codes = (r) => (r.ok ? [] : r.problems.map((p) => `${p.field}:${p.code}`).sort());
const refusedWith = (a, expected, label) => { const r = judge(a); assert.equal(r.ok, false, label + ": refused"); for (const e of [].concat(expected)) assert.ok(codes(r).includes(e), `${label}: ${e} in ${JSON.stringify(codes(r))}`); };

test("RF-11 the acceptance record: every reviewed field required, the SHA-256 of the accepted blob's exact bytes, a real calendar date, an independent reviewer, a scope naming the blob — all problems reported", () => {
  assert.equal(sha(ACCEPTED), "2613f4d501cfe93e4deba68e68c1daf7a214d21ddf4b4da25450b51c04e3d4ec", "(the accepted Rules bytes' SHA-256, computed here)");
  // CONTROL: a complete synthetic record is a valid RECORD (the validator is not a blanket refusal); an extra field is not a problem
  assert.deepEqual(judge(synthetic()), { ok: true });
  assert.deepEqual(judge({ ...synthetic(), note: "SYNTHETIC extra field" }), { ok: true });
  // required: a missing field is refused — the review's four owner / reference fields and the other four
  for (const f of ACCEPTANCE_FIELDS) { const a = synthetic(); delete a[f]; refusedWith(a, `${f}:missing`, `${f} absent`); }
  for (const f of ACCEPTANCE_FIELDS) for (const v of ["", "   ", null, 7, ["x"]]) refusedWith({ ...synthetic(), [f]: v }, `${f}:${typeof v === "string" ? "empty" : "not_a_string"}`, `${f} = ${JSON.stringify(v)}`);
  // the RF2 proposal's literal template: every owner / date / scope / reference field is a placeholder
  const template = { rulesBlob: ACCEPTED, rulesSha256: sha(ACCEPTED), acceptedBy: "<owner identity>", acceptedAt: "<YYYY-MM-DD>", scope: "<exact scope, naming the blob 27887d72 and Marjin 1.0>", recordRef: "<where the owner's acceptance record lives>", reviewedBy: "<independent reviewer of the re-pin successor>", reviewRef: "<review package / verdict line>" };
  refusedWith(template, ["acceptedBy:placeholder", "acceptedAt:placeholder", "scope:placeholder", "recordRef:placeholder", "reviewedBy:placeholder", "reviewRef:placeholder"], "the v2 template");
  for (const v of ["TBD", "todo: owner", "Placeholder", "x <y>"]) refusedWith({ ...synthetic(), recordRef: v }, "recordRef:placeholder", v);
  // the digest is the accepted blob's bytes, never shape alone
  refusedWith({ ...synthetic(), rulesSha256: "0".repeat(64) }, "rulesSha256:sha256_mismatch", "all-zero SHA-256");
  refusedWith({ ...synthetic(), rulesSha256: sha(X.APPROVED_RULES_BLOB) }, "rulesSha256:sha256_mismatch", "the release pin's SHA-256 under the accepted blob");
  refusedWith({ ...synthetic(), rulesSha256: sha(ACCEPTED).toUpperCase() }, "rulesSha256:not_a_sha256", "upper-case hex");
  refusedWith({ ...synthetic(), rulesSha256: sha(ACCEPTED).slice(1) }, "rulesSha256:not_a_sha256", "63 hex digits");
  refusedWith({ ...synthetic(), rulesBlob: DIAGNOSTIC_SENTINEL, scope: `scope ${DIAGNOSTIC_SENTINEL.slice(0, 8)}` }, ["rulesBlob:blob_unavailable", "rulesSha256:unverifiable"], "a blob that is not in the repository");
  const head = gitIn(X.ROOT, ["rev-parse", "HEAD"]).stdout.trim();
  refusedWith({ ...synthetic(), rulesBlob: head, scope: `scope ${head.slice(0, 8)}` }, ["rulesBlob:blob_unavailable", "rulesSha256:unverifiable"], "a commit id, not a blob");
  refusedWith({ ...synthetic(), rulesBlob: ACCEPTED.slice(0, 12) }, ["rulesBlob:not_a_blob_id", "rulesSha256:unverifiable"], "an abbreviated id");
  // the date: a real calendar date, not in the future
  for (const d of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "2026-10-00", "2026-04-31", "2026-1-5", "14/10/2026", "2026-10-14T10:00:00Z", "2026-10-14 "]) refusedWith({ ...synthetic(), acceptedAt: d }, "acceptedAt:not_a_calendar_date", d);
  assert.deepEqual(judge({ ...synthetic(), acceptedAt: "2024-02-29" }), { ok: true }, "a leap day is a calendar date");
  assert.deepEqual(judge({ ...synthetic(), acceptedAt: TODAY }), { ok: true }, "today is not the future");
  refusedWith({ ...synthetic(), acceptedAt: "2026-10-16" }, "acceptedAt:in_the_future", "tomorrow");
  assert.ok(isCalendarDate("2028-02-29") && !isCalendarDate("2100-02-29"));
  // independence and scope (RF2's proposed rules, kept)
  for (const r of ["SYNTHETIC DIAGNOSTIC acceptor A (not a person, not an acceptance)", "  synthetic diagnostic ACCEPTOR a (not a person,   not an acceptance) "]) refusedWith({ ...synthetic(), reviewedBy: r }, "reviewedBy:same_as_acceptor", "the reviewer is the acceptor: " + r);
  refusedWith({ ...synthetic(), scope: "SYNTHETIC scope naming no blob" }, "scope:does_not_name_the_blob", "a scope without the blob");
  // shape and the caller's obligations
  for (const v of [null, [], "record", 5]) assert.deepEqual(judge(v), { ok: false, problems: [{ field: "*", code: "not_a_record" }] });
  assert.throws(() => validateRulesOwnerAcceptance(synthetic(), {}), /readBlob is required/);
  assert.throws(() => validateRulesOwnerAcceptance(synthetic(), { readBlob, today: "2026-02-31" }), /today must be a calendar date/);
  // every problem at once
  assert.deepEqual(codes(judge({ rulesBlob: ACCEPTED, rulesSha256: "0".repeat(64), acceptedAt: "2026-02-31", scope: "no blob here" })), ["acceptedAt:not_a_calendar_date", "acceptedBy:missing", "recordRef:missing", "reviewRef:missing", "reviewedBy:missing", "rulesSha256:sha256_mismatch", "scope:does_not_name_the_blob"]);
});

test("RF-12 the record status: this tree has NO record (publication pending, release pin unchanged); invalid / pin-mismatch / complete are distinguished and none is reported as publication", () => {
  const opts = { readBlob, today: TODAY }, pending = "pending (not established by any source fact)";
  assert.deepEqual(acceptanceRecordStatus(X, opts), { status: "absent", publication: pending }, "this repository: no acceptance record");
  assert.equal(X.APPROVED_RULES_BLOB, "32ea32bfc9b70c16c06b1acf87d045c5e28ff1d8", "the release pin is unchanged");
  const template = { ...synthetic(), acceptedBy: "<owner identity>" };
  const invalid = acceptanceRecordStatus({ RULES_OWNER_ACCEPTANCE: template, APPROVED_RULES_BLOB: ACCEPTED }, opts);
  assert.equal(invalid.status, "invalid"); assert.deepEqual(invalid.problems, [{ field: "acceptedBy", code: "placeholder" }]); assert.equal(invalid.publication, pending);
  assert.deepEqual(acceptanceRecordStatus({ RULES_OWNER_ACCEPTANCE: synthetic(), APPROVED_RULES_BLOB: X.APPROVED_RULES_BLOB }, opts), { status: "pin_mismatch", publication: pending }, "a valid record does not move the pin by itself");
  // a complete SYNTHETIC record with the pin moved (a module namespace built here, never the fixture) is a complete RECORD only
  assert.deepEqual(acceptanceRecordStatus({ RULES_OWNER_ACCEPTANCE: synthetic(), APPROVED_RULES_BLOB: ACCEPTED }, opts), { status: "complete", publication: pending }, "even complete: a source fact, publication still pending");
});
