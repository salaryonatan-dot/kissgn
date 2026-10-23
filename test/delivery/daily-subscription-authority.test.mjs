// Daily e-mail subscription correction C1 (author candidate, pending independent review): authority and target binding of
// action "subscription" / "subscription_set" on the REAL route (harness sandbox; only the database, the token verifier and
// the provider are replaced). No network, no real e-mail.
//   DSA-01  a FOREIGN ordinary owner (owner of another tenant) is refused on this tenant's business: read and change, 403,
//           nothing written, no address in the reply
//   DSA-02  a tenant-local super_owner of ANOTHER tenant is not global authority: refused exactly like DSA-01
//   DSA-03  exact target-registry binding for the tenant's own owner: an unregistered business, another tenant's business id,
//           an ambiguous registry entry and unaddressable ids are refused before any preference read or write
//   (not covered here) global platform-owner cross-tenant read / change: NO verified platform-owner identity exists in this
//   tree (the only Admin mechanism is `super_owner` held in ANY tenant — authority finding A1 / RC-1). It is the open
//   dependency D-PA-01 / RC-1 and is reported, not implemented, by this correction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, seedWorld, installSmtp, freezeClock, mkRes, T, B, B2, T2, B3, SUBSCRIPTIONS } from "../support/daily-email-harness.mjs";

const { route } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);
const env = (v) => ({ _v: JSON.stringify(v) });
const sub = (t, b) => globalThis.__DB.read(`${SUBSCRIPTIONS}/${t}/${b}`);
async function post(body, who) {
  globalThis.__DE = { requireAuth: async () => (who ? who : (() => { throw new Error("no auth"); })()) };
  const res = mkRes(); const u = freezeClock(AT);
  try { await route({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res); } finally { u(); }
  return res;
}
const both = async (ids, who) => [await post({ ...ids, action: "subscription" }, who), await post({ ...ids, action: "subscription_set", enabled: true }, who)];
const OWNER_A = { uid: "u_owner_a", email: "owner-a@example.test" }, OWNER_B = { uid: "u_owner_b", email: "owner-b@example.test" };
const SUPER_B = { uid: "u_super_b", email: "super-b@example.test" };
const world = () => {
  const db = seedWorld({ withSecondBiz: true, withSecondTenant: true, subscriptions: "absent" });
  db.seed(`tenants/${T2}/members/${SUPER_B.uid}`, true); db.seed(`tenants/${T2}/roles/${SUPER_B.uid}`, "super_owner");
  installSmtp([]);
  return db;
};
const nothingWritten = () => assert.equal(globalThis.__DB.read(SUBSCRIPTIONS), null, "no preference written anywhere");

test("DSA-01 a foreign ordinary owner is refused on this tenant's business", async () => {
  world();
  for (const r of await both({ tenantId: T, bizId: B }, OWNER_B)) {
    assert.deepEqual([r.statusCode, r.body.error], [403, "not a tenant member"], JSON.stringify(r.body));
    assert.ok(!/@example\.test/.test(JSON.stringify(r.body)), "no address in the reply");
  }
  nothingWritten();
  const own = await post({ tenantId: T2, bizId: B3, action: "subscription_set", enabled: true }, OWNER_B);
  assert.deepEqual([own.statusCode, own.body.enabled, sub(T2, B3).updatedByRole], [200, true, "owner"], "control: the same owner on its own tenant");
  assert.equal(sub(T, B), null);
});

test("DSA-02 a tenant-local super_owner of another tenant is not global authority", async () => {
  world();
  for (const ids of [{ tenantId: T, bizId: B }, { tenantId: T, bizId: B2 }])
    for (const r of await both(ids, SUPER_B)) assert.deepEqual([r.statusCode, r.body.error], [403, "not a tenant member"], JSON.stringify([ids, r.body]));
  nothingWritten();
  const own = await post({ tenantId: T2, bizId: B3, action: "subscription" }, SUPER_B);
  assert.deepEqual([own.statusCode, own.body.enabled], [200, false], "control: the role holds in its own tenant only");
});

test("DSA-03 exact target-registry binding: unregistered, foreign, ambiguous and unaddressable targets are refused", async () => {
  let db = world();
  const refusals = [
    [{ tenantId: T, bizId: "bizNotRegistered" }, 404, "business_not_registered"],
    [{ tenantId: T, bizId: B3 }, 404, "business_not_registered"],                    // T2's registered business, asked under T
  ];
  for (const [ids, status, code] of refusals)
    for (const r of await both(ids, OWNER_A)) assert.deepEqual([r.statusCode, r.body.code], [status, code], JSON.stringify([ids, r.body]));
  for (const [ids, status] of [[{ tenantId: T, bizId: "biz:A" }, 400], [{ tenantId: T, bizId: "biz\u0007A" }, 400], [{ tenantId: T, bizId: "" }, 400], [{ tenantId: "", bizId: B }, 400], [{ tenantId: T }, 400]])
    for (const r of await both(ids, OWNER_A)) assert.equal(r.statusCode, status, JSON.stringify([ids, r.statusCode, r.body]));
  nothingWritten();
  db = world(); db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "א" }, { id: B, name: "א2" }]));
  for (const r of await both({ tenantId: T, bizId: B }, OWNER_A)) assert.deepEqual([r.statusCode, r.body.code], [422, "ambiguous_business_identity"], JSON.stringify(r.body));
  nothingWritten();
  db = world();
  const ok = await post({ tenantId: T, bizId: B2, action: "subscription_set", enabled: true }, OWNER_A);
  assert.deepEqual([ok.statusCode, ok.body.bizId, sub(T, B2).enabled, sub(T, B)], [200, B2, true, null], "control: the exact registered target only");
});
