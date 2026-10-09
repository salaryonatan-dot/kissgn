// Runtime sensitivity checks against the real builder entrypoint in an isolated compiled tree.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileServer, installDb, makeDb, offlineFetch, seedBusiness } from '../../test/support/server-reader-harness.mjs';

offlineFetch();
const compiled = compileServer();
const original = readFileSync(join(compiled.dir, 'src/snapshot/snapshotBuilder.js'), 'utf8');
const control = await compiled.import('src/snapshot/snapshotBuilder.js');
const NOW = Date.UTC(2026, 8, 29, 9);
const ID = { tenantId: 'tenantA', bizId: 'a', businessDate: '2026-09-29' };
function fixture(businesses) {
  const db = installDb(makeDb());
  seedBusiness(db, { tenant: 'tenantA', biz: 'a', entries: null, businesses: [{ id: 'a', name: 'A' }] });
  db.seed('tenants/tenantA/app/business', businesses);
  return db;
}
async function check(id, before, after, setup, verify) {
  assert.equal(original.split(before).length, 2, `${id}: unique compiled mutation site`);
  setup();
  await verify(await control.buildSnapshotRun({ nowMs: NOW }));
  const path = join(compiled.dir, 'src/snapshot', `snapshotBuilder-r2-${id}.js`);
  writeFileSync(path, original.replace(before, after));
  const mutant = await import(pathToFileURL(path).href);
  setup();
  let caught = false;
  try { await verify(await mutant.buildSnapshotRun({ nowMs: NOW })); }
  catch (error) { caught = true; console.log(`${id}: CAUGHT (${error instanceof Error ? error.name : 'unknown'})`); }
  assert.equal(caught, true, `${id}: behavior mutant survived`);
}
await check('unrelated-null-blocks', 'if (biz === null)\n                            continue;',
  'if (biz === null) { discoveryFailed("app_business", "malformed_entry"); continue; }',
  () => fixture({ _v: JSON.stringify([null, { id: 'a', name: 'A' }]) }),
  (run) => { assert.equal(run.status, 'complete'); assert.deepEqual(run.snapshots.map((s) => s.bizId), ['a']); });
await check('first-duplicate-name', 'if (matches.length > 1)\n        throw new Error("ambiguous_business_identity");',
  'if (false) throw new Error("ambiguous_business_identity");',
  () => fixture({ _v: JSON.stringify([{ id: 'a', name: 'Old', active: false }, { id: 'a', name: 'New' }]) }),
  (run) => { assert.equal(run.status, 'incomplete'); assert.deepEqual(run.failedBuilds, [{ ...ID, code: 'ambiguous_business_identity' }]); assert.deepEqual(run.snapshots, []); });
await check('raw-array-accepted', 'function registryRows(value) {',
  'function registryRows(value) { if (Array.isArray(value)) return value;',
  () => fixture([{ id: 'a', name: 'A' }]),
  (run) => { assert.equal(run.status, 'incomplete'); assert.deepEqual(run.expectedBusinesses, []); });
await check('padded-id-coerced', 'value === value.trim()', 'true',
  () => fixture({ _v: JSON.stringify([{ id: ' a', name: 'A' }]) }),
  (run) => { assert.equal(run.status, 'incomplete'); assert.deepEqual(run.expectedBusinesses, []); });
const indexFailure = 'discoveryFailed("proactive_biz_index", "malformed_entry");';
assert.equal(original.split(indexFailure).length, 3, 'two independent malformed-index branches');
for (const [i, id] of ['malformed-index-value-silent', 'malformed-index-id-silent'].entries()) {
  const pieces = original.split(indexFailure);
  const mutated = pieces[0] + (i === 0 ? '' : indexFailure) + pieces[1]
    + (i === 1 ? '' : indexFailure) + pieces[2];
  const path = join(compiled.dir, 'src/snapshot', `snapshotBuilder-r2-${id}.js`);
  writeFileSync(path, mutated);
  const mutant = await import(pathToFileURL(path).href);
  const setup = () => {
    const db = installDb(makeDb());
    db.seed('proactive_biz_index', { 'tenantA:badValue': 17, ' tenantA:badId': true });
  };
  const verify = (run) => {
    assert.equal(run.status, 'incomplete');
    assert.deepEqual(run.discovery.failures, [
      { source: 'proactive_biz_index', code: 'malformed_entry' },
      { source: 'proactive_biz_index', code: 'malformed_entry' },
    ]);
  };
  setup();
  verify(await control.buildSnapshotRun({ nowMs: NOW }));
  setup();
  let caught = false;
  try { verify(await mutant.buildSnapshotRun({ nowMs: NOW })); }
  catch (error) { caught = true; console.log(`${id}: CAUGHT (${error instanceof Error ? error.name : 'unknown'})`); }
  assert.equal(caught, true, `${id}: behavior mutant survived`);
}
console.log('6/6 registry mutations caught');
