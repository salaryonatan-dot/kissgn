import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileServer, installDb, makeDb, offlineFetch, seedBusiness } from '../../test/support/server-reader-harness.mjs';

offlineFetch();
const compiled = compileServer();
const original = readFileSync(join(compiled.dir, 'src/snapshot/snapshotBuilder.js'), 'utf8');
const seedFailedRun = () => {
  const db = installDb(makeDb());
  const businesses = [{ id: 'good', name: 'Good' }, { id: 'bad', name: 'Bad' }];
  for (const biz of businesses) seedBusiness(db, { tenant: 'tenantA', biz: biz.id, entries: null, businesses });
  const prior = db.ref;
  db.ref = (path, query) => {
    const ref = prior(path, query);
    return path === 'tenants/tenantA/biz:bad:entries'
      ? { ...ref, once: async () => { throw Error('controlled'); }, get: async () => { throw Error('controlled'); } }
      : ref;
  };
};
async function catchMutation(label, needle, replacement) {
  assert.equal(original.split(needle).length, 2, `${label}: unique mutation site`);
  const path = join(compiled.dir, 'src/snapshot', `snapshotBuilder-${label}.js`);
  writeFileSync(path, original.replace(needle, replacement));
  const mod = await import(pathToFileURL(path).href);
  seedFailedRun();
  await assert.rejects(mod.buildSnapshotRun({ nowMs: Date.UTC(2026, 8, 29, 9) }), /snapshot_accounting_invariant/);
  console.log(`CAUGHT ${label}: accounting invariant rejects mutated real entrypoint`);
}
await catchMutation('swallow-failed-build',
  'failedBuilds.push({ ...identity(tenantId, bizId), code: error instanceof Error && error.message === "ambiguous_business_identity"\n                    ? "ambiguous_business_identity" : "snapshot_build_failed" });',
  'void identity(tenantId, bizId);');
await catchMutation('omit-expected-businesses',
  'const expectedBusinesses = activeBusinesses.map(({ tenantId, bizId }) => identity(tenantId, bizId));',
  'const expectedBusinesses = [];');
assert.equal(original.split('timeZone: "Asia/Jerusalem"').length, 2, 'date timezone mutation site');
const utcPath = join(compiled.dir, 'src/snapshot', 'snapshotBuilder-utc-date.js');
writeFileSync(utcPath, original.replace('timeZone: "Asia/Jerusalem"', 'timeZone: "UTC"'));
const utcMutant = await import(pathToFileURL(utcPath).href);
installDb(makeDb());
const utcResult = await utcMutant.buildSnapshotRun({ nowMs: Date.UTC(2026, 8, 28, 21) });
assert.notEqual(utcResult.businessDate, '2026-09-29', 'UTC date mutant must violate Israel midnight contract');
console.log('CAUGHT utc-date: independent Israel-midnight expectation rejects mutated run date');
console.log('3/3 builder mutations caught');
