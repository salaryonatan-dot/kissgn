// Focused pure tests for the FIREBASE_CONFIG safety validator used by the RTDB
// authorization matrix harness. No emulator, no network — imports the pure
// exported validator (the harness main() runs only on direct execution).
//
// Run: node --test test/emulator/safety.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";

const DEMO_OK = JSON.stringify({
  projectId: "demo-marjin-rules",
  storageBucket: "demo-marjin-rules.appspot.com",
  databaseURL: "https://demo-marjin-rules.firebaseio.com",
});

test("exact allowed demo FIREBASE_CONFIG (as injected by the CLI) is accepted", () => {
  const r = validateFirebaseConfig(DEMO_OK);
  assert.equal(r.ok, true, r.reason);
});

test("absent FIREBASE_CONFIG is accepted", () => {
  assert.equal(validateFirebaseConfig(undefined).ok, true);
  assert.equal(validateFirebaseConfig(null).ok, true);
  assert.equal(validateFirebaseConfig("").ok, true);
});

test("malformed JSON is rejected", () => {
  const r = validateFirebaseConfig("{not json");
  assert.equal(r.ok, false);
  assert.match(r.reason, /not valid JSON/);
});

test("real / non-demo projectId is rejected", () => {
  const r = validateFirebaseConfig(JSON.stringify({ projectId: "acme-prod-1234" }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /projectId must be demo-marjin-rules/);
});

test("demo project with mismatched databaseURL is rejected", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    databaseURL: "https://demo-marjin-rules-wrong.firebaseio.com",
  }));
  assert.equal(r.ok, false);
});

test("demo project with mismatched storageBucket is rejected", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    storageBucket: "acme-prod.appspot.com",
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /storageBucket/);
});

test("arbitrary Production firebaseio URL is rejected", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    databaseURL: "https://totally-real-prod.firebaseio.com",
  }));
  assert.equal(r.ok, false);
});

// Extra hardening cases
test("Production host hidden in an unrelated field is rejected (defense in depth)", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    somethingElse: "https://evil-prod.firebaseio.com",
  }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /non-demo Firebase host/);
});

test("demo default-rtdb namespace databaseURL form is accepted", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    databaseURL: "https://demo-marjin-rules-default-rtdb.firebaseio.com",
  }));
  assert.equal(r.ok, true, r.reason);
});

test("localhost databaseURL form is accepted", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    databaseURL: "http://127.0.0.1:9000?ns=demo-marjin-rules-default-rtdb",
  }));
  assert.equal(r.ok, true, r.reason);
});

test("look-alike prefixed host (demo-marjin-rules.evil.firebaseio.com) is rejected", () => {
  const r = validateFirebaseConfig(JSON.stringify({
    projectId: "demo-marjin-rules",
    databaseURL: "https://demo-marjin-rules.evil.firebaseio.com",
  }));
  assert.equal(r.ok, false);
});

test("non-object JSON (array) is rejected", () => {
  assert.equal(validateFirebaseConfig("[1,2,3]").ok, false);
});
