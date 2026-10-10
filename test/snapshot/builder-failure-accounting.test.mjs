import test from 'node:test';
import assert from 'node:assert/strict';
import { compileServer, installDb, makeDb, offlineFetch, seedBusiness } from '../support/server-reader-harness.mjs';

offlineFetch();
const { buildSnapshotRun, buildSnapshotForAll, buildSnapshotForBiz } = await compileServer().import('src/snapshot/snapshotBuilder.js');
const NOW = Date.UTC(2026, 8, 29, 9);
const DATE = '2026-09-29';
const identity = (tenantId, bizId) => ({ tenantId, bizId, businessDate: DATE });
function seed(db, tenant, ids) {
  const businesses = ids.map((id) => ({ id, name: `Biz ${id}` }));
  for (const biz of businesses) seedBusiness(db, { tenant, biz: biz.id, entries: null, businesses });
}
function failReads(db, targets, secret = 'private error detail') {
  const prior = db.ref;
  db.ref = (path, query) => {
    const ref = prior(path, query);
    return targets.some(([tenant, biz]) => path === `tenants/${tenant}/biz:${biz}:entries`)
      ? { ...ref, once: async () => { throw Error(secret); }, get: async () => { throw Error(secret); } }
      : ref;
  };
}

test('all eligible businesses succeed with unchanged financial snapshots', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a', 'b']);
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.version, 'MARJIN_SNAPSHOT_BUILD_RUN/1');
  assert.equal(result.businessDate, DATE);
  assert.equal(result.status, 'complete');
  assert.equal(result.discovery.status, 'complete');
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'a'), identity('tenantA', 'b')]);
  assert.deepEqual(result.failedBuilds, []);
  assert.deepEqual(result.exclusions, []);
  assert.deepEqual(result.snapshots, [
    await buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }),
    await buildSnapshotForBiz('tenantA', 'b', { nowMs: NOW }),
  ]);
  assert.ok(result.snapshots.every((s) => s.date === DATE));
});

test('partial failure retains identity, date, and safe code', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['good', 'bad']);
  failReads(db, [['tenantA', 'bad']]);
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'good'), identity('tenantA', 'bad')]);
  assert.deepEqual(result.snapshots.map(({ tenantId, bizId, date }) => ({ tenantId, bizId, date })), [
    { tenantId: 'tenantA', bizId: 'good', date: DATE },
  ]);
  assert.deepEqual(result.failedBuilds, [{ ...identity('tenantA', 'bad'), code: 'snapshot_build_failed' }]);
  assert.doesNotMatch(JSON.stringify(result), /private error detail/);
  assert.equal(result.expectedBusinesses.length, result.snapshots.length + result.failedBuilds.length);
  const clock = Date.now;
  Date.now = () => NOW;
  try { assert.deepEqual(await buildSnapshotForAll(), result.snapshots); }
  finally { Date.now = clock; }
});

test('all eligible builds failing is incomplete, unlike an empty run', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a', 'b']);
  failReads(db, [['tenantA', 'a'], ['tenantA', 'b']]);
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.snapshots, []);
  assert.deepEqual(result.failedBuilds, [
    { ...identity('tenantA', 'a'), code: 'snapshot_build_failed' },
    { ...identity('tenantA', 'b'), code: 'snapshot_build_failed' },
  ]);
});

test('no eligible businesses is a complete empty run', async () => {
  installDb(makeDb());
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.expectedBusinesses, []);
  assert.deepEqual(result.snapshots, []);
  assert.deepEqual(result.failedBuilds, []);
});

test('explicit inactivity and index-only entries are intentional exclusions', async () => {
  const db = installDb(makeDb());
  db.seed('tenants/tenantA/app/business', { _v: JSON.stringify([
    { id: 'active', name: 'Active' },
    { id: 'inactive', name: 'Inactive', active: false },
  ]) });
  seedBusiness(db, { tenant: 'tenantA', biz: 'active', entries: null, businesses: [
    { id: 'active', name: 'Active' }, { id: 'inactive', name: 'Inactive', active: false },
  ] });
  db.seed('proactive_biz_index', { 'tenantA:indexOnly': true });
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'active')]);
  assert.deepEqual(result.exclusions, [
    { ...identity('tenantA', 'inactive'), reason: 'explicit_inactive' },
    { ...identity('tenantA', 'indexOnly'), reason: 'index_only' },
  ]);
  assert.equal(result.status, 'complete');
});

test('same business ID in separate tenants remains isolated', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['shared']);
  seed(db, 'tenantB', ['shared']);
  failReads(db, [['tenantB', 'shared']]);
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'shared'), identity('tenantB', 'shared')]);
  assert.deepEqual(result.snapshots.map(({ tenantId, bizId }) => ({ tenantId, bizId })), [{ tenantId: 'tenantA', bizId: 'shared' }]);
  assert.deepEqual(result.failedBuilds, [{ ...identity('tenantB', 'shared'), code: 'snapshot_build_failed' }]);
});

test('business without authoritative name is a failed expected build', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['unnamed']);
  db.seed('tenants/tenantA/app/business', { _v: JSON.stringify([{ id: 'unnamed' }]) });
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'unnamed')]);
  assert.deepEqual(result.failedBuilds, [{ ...identity('tenantA', 'unnamed'), code: 'business_name_unavailable' }]);
  assert.deepEqual(result.snapshots, []);
  assert.equal(result.status, 'incomplete');
});

test('a literal Unknown is a real name; missing names fail before any financial read', async () => {
  const db = installDb(makeDb());
  seedBusiness(db, { tenant: 'tenantA', biz: 'named', entries: null, businesses: [
    { id: 'named', name: 'Unknown' }, { id: 'unnamed', name: '   ' },
  ] });
  const paths = [];
  const prior = db.ref;
  db.ref = (path, query) => { paths.push(path); return prior(path, query); };
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(run.expectedBusinesses, [identity('tenantA', 'named'), identity('tenantA', 'unnamed')]);
  assert.deepEqual(run.snapshots.map(({ bizId, bizName }) => [bizId, bizName]), [['named', 'Unknown']]);
  assert.deepEqual(run.failedBuilds, [{ ...identity('tenantA', 'unnamed'), code: 'business_name_unavailable' }]);
  assert.equal(paths.some((path) => path.includes('biz:unnamed:')), false);
  await assert.rejects(buildSnapshotForBiz('tenantA', 'unnamed', { nowMs: NOW }), { message: 'business_name_unavailable' });
});

test('manual registry outcomes have the coordination-contract codes', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a']);
  const registry = 'tenants/tenantA/app/business';
  db.seed(registry, { _v: '[]' });
  await assert.rejects(buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }), { message: 'business_not_registered' });
  db.seed(registry, { _v: '[' });
  await assert.rejects(buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }), { message: 'registry_unreadable' });
  db.seed(registry, { _v: JSON.stringify([{ id: 'a', name: 'A' }]) });
  const prior = db.ref;
  db.ref = (path, query) => path === registry
    ? { ...prior(path, query), once: async () => { throw Error('private transport failure'); } }
    : prior(path, query);
  await assert.rejects(buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }), { message: 'registry_unavailable' });
});

test('a registry change after discovery keeps its precise scheduled failure code', async () => {
  for (const [afterDiscovery, code] of [
    [{ _v: '[]' }, 'business_not_registered'],
    [{ _v: '[' }, 'registry_unreadable'],
  ]) {
    const db = installDb(makeDb());
    seed(db, 'tenantA', ['a']);
    const path = 'tenants/tenantA/app/business';
    const prior = db.ref;
    db.ref = (p, query) => p === path
      ? { ...prior(p, query), once: async () => ({ val: () => afterDiscovery }) }
      : prior(p, query);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.deepEqual(run.expectedBusinesses, [identity('tenantA', 'a')]);
    assert.deepEqual(run.failedBuilds, [{ ...identity('tenantA', 'a'), code }]);
    assert.deepEqual(run.snapshots, []);
    assert.equal(run.status, 'incomplete');
  }
});

test('an unrelated financial read error cannot spoof a registry refusal code', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a']);
  failReads(db, [['tenantA', 'a']], 'registry_unreadable');
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(run.failedBuilds, [{ ...identity('tenantA', 'a'), code: 'snapshot_build_failed' }]);
  await assert.rejects(buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }), (error) => {
    assert.equal(error.name, 'Error');
    assert.equal(error.message, 'registry_unreadable');
    assert.equal(Object.hasOwn(error, 'code'), false);
    return true;
  });
});

test('manual registry refusals carry a distinct bounded provenance marker', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a']);
  db.seed('tenants/tenantA/app/business', { _v: '[' });
  await assert.rejects(buildSnapshotForBiz('tenantA', 'a', { nowMs: NOW }), (error) => {
    assert.equal(error.name, 'SnapshotIdentityRefusal');
    assert.equal(Object.hasOwn(error, 'code'), true);
    assert.equal(error.code, 'registry_unreadable');
    assert.equal(error.message, error.code);
    return true;
  });
});

test('control characters are discovery failures; valid tenant colon remains exact', async () => {
  const db = installDb(makeDb());
  seedBusiness(db, { tenant: 't:1', biz: ' b', entries: null, businesses: [{ id: ' b', name: 'Good' }] });
  db.seed('tenants/tenantA/app/business', { _v: JSON.stringify([{ id: 'bad\u0001id', name: 'Bad' }, { id: 'bad\u007fid', name: 'Bad' }]) });
  db.seed('proactive_biz_index', {
    badBusiness: { tenantId: 't:1', bizId: 'bad\u0002id' },
    badTenant: { tenantId: 't\u0001', bizId: 'safe' },
  });
  const paths = [];
  const prior = db.ref;
  db.ref = (path, query) => { paths.push(path); return prior(path, query); };
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(run.expectedBusinesses, [identity('t:1', ' b')]);
  assert.deepEqual(run.snapshots.map(({ tenantId, bizId }) => [tenantId, bizId]), [['t:1', ' b']]);
  assert.deepEqual(run.discovery.failures, [
    { source: 'proactive_biz_index', code: 'malformed_entry' },
    { source: 'proactive_biz_index', code: 'malformed_entry' },
    { source: 'app_business', code: 'malformed_entry' },
    { source: 'app_business', code: 'malformed_entry' },
  ]);
  assert.equal(paths.some((path) => path.includes('bad\u0001id') || path.includes('bad\u007fid')), false);
  await assert.rejects(buildSnapshotForBiz('t:1', 'bad\u0001id', { nowMs: NOW }), { message: 'invalid_business_identity' });
  await assert.rejects(buildSnapshotForBiz('t\u0001', 'safe', { nowMs: NOW }), { message: 'invalid_business_identity' });
});

test('discovery read failure is incomplete even without expected identities', async () => {
  const db = installDb(makeDb());
  const prior = db.ref;
  db.ref = (path, query) => path === 'tenants'
    ? { ...prior(path, query), once: async () => { throw Error('secret discovery error'); } }
    : prior(path, query);
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.expectedBusinesses, []);
  assert.deepEqual(result.discovery, { status: 'failed', failures: [{ source: 'app_business', code: 'read_failed' }] });
  assert.doesNotMatch(JSON.stringify(result), /secret discovery error/);
});

test('legacy self and explicitly inactive index identities remain exclusions', async () => {
  const db = installDb(makeDb());
  db.seed('proactive_biz_index', {
    'tenantA:tenantA': true,
    'tenantA:inactive': false,
  });
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(result.expectedBusinesses, []);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.exclusions, [
    { ...identity('tenantA', 'tenantA'), reason: 'legacy_self' },
    { ...identity('tenantA', 'inactive'), reason: 'explicit_inactive' },
  ]);
});

test('malformed index entries fail discovery instead of becoming a clean empty run', async () => {
  const db = installDb(makeDb());
  db.seed('proactive_biz_index', {
    'tenantA:badValue': 17,
    'bad#tenant:badId': true,
  });
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.discovery, {
    status: 'failed',
    failures: [
      { source: 'proactive_biz_index', code: 'malformed_entry' },
      { source: 'proactive_biz_index', code: 'malformed_entry' },
    ],
  });
  assert.deepEqual(result.expectedBusinesses, []);
  assert.deepEqual(result.snapshots, []);
  assert.deepEqual(result.exclusions, []);
});

test('unrelated bare null does not block the uniquely registered target', async () => {
  const db = installDb(makeDb());
  db.seed('tenants/tenantA/app/business', { _v: JSON.stringify([null, { id: 'ok', name: 'Ok' }]) });
  seedBusiness(db, { tenant: 'tenantA', biz: 'ok', entries: null, businesses: [null, { id: 'ok', name: 'Ok' }] });
  const result = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.expectedBusinesses, [identity('tenantA', 'ok')]);
  assert.deepEqual(result.discovery.failures, []);
  assert.deepEqual(result.snapshots.map((s) => s.bizId), ['ok']);
  assert.deepEqual(result.failedBuilds, []);
});

test('both duplicate orders fail the target without a first-match name', async () => {
  for (const businesses of [
    [{ id: 'a', name: 'Old', active: false }, { id: 'a', name: 'New' }],
    [{ id: 'a', name: 'New' }, { id: 'a', name: 'Old', active: false }],
  ]) {
    const db = installDb(makeDb());
    seedBusiness(db, { tenant: 'tenantA', biz: 'a', entries: null, businesses });
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.deepEqual(run.expectedBusinesses, [identity('tenantA', 'a')]);
    assert.deepEqual(run.snapshots, []);
    assert.deepEqual(run.failedBuilds, [{ ...identity('tenantA', 'a'), code: 'ambiguous_business_identity' }]);
    assert.equal(run.status, 'incomplete');
  }
});

test('unsupported registry shapes and an identity-free null registry cannot become a clean run', async () => {
  for (const raw of [
    [{ id: 'a', name: 'A' }],
    JSON.stringify([{ id: 'a', name: 'A' }]),
    { _v: JSON.stringify([null]) },
  ]) {
    const db = installDb(makeDb());
    db.seed('tenants/tenantA/app/business', raw);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'incomplete');
    assert.equal(run.discovery.status, 'failed');
    assert.deepEqual(run.expectedBusinesses, []);
    assert.deepEqual(run.snapshots, []);
  }
});

test('an unreadable tenant list is a discovery failure, not a clean empty run', async () => {
  const db = installDb(makeDb());
  const prior = db.ref;
  db.ref = (path, query) => path === 'tenants'
    ? { ...prior(path, query), once: async () => { throw Error('private@example.test token=secret'); } }
    : prior(path, query);
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(run.status, 'incomplete');
  assert.deepEqual(run.discovery.failures, [{ source: 'app_business', code: 'read_failed' }]);
  assert.doesNotMatch(JSON.stringify(run), /private@example|secret/);
});

test('present malformed registry and primitive tenant or app never become a clean empty run', async () => {
  for (const raw of [0, false, '', true, 7, [], '[]', { _v: 'not-json' }, { _v: '{}' }]) {
    const db = installDb(makeDb());
    db.seed('tenants/t/app/business', raw);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'incomplete', `raw ${JSON.stringify(raw)}`);
    assert.deepEqual(run.discovery.failures, [{ source: 'app_business', code: 'malformed_source' }]);
    assert.deepEqual(run.expectedBusinesses, []);
  }
  for (const [path, value] of [['tenants/t', 'bad tenant'], ['tenants/t/app', false], ['tenants/t/app', []]]) {
    const db = installDb(makeDb());
    db.seed(path, value);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'incomplete', path);
    assert.deepEqual(run.discovery.failures, [{ source: 'app_business', code: 'malformed_source' }]);
  }
});

test('truly absent and valid empty registry states remain clean empty discovery', async () => {
  for (const seedNode of [null, {}, { app: {} }, { app: { business: { _v: '[]' } } }]) {
    const db = installDb(makeDb());
    if (seedNode !== null) db.seed('tenants/t', seedNode);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.deepEqual(run.discovery, { status: 'complete', failures: [] });
    assert.equal(run.status, 'complete');
    assert.deepEqual(run.expectedBusinesses, []);
  }
});

test('malformed inactive index identity is a discovery failure, not an exclusion', async () => {
  const db = installDb(makeDb());
  db.seed('proactive_biz_index', { 'bad#t:wrong': false, 't:good': false });
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(run.status, 'incomplete');
  assert.deepEqual(run.discovery.failures, [{ source: 'proactive_biz_index', code: 'malformed_entry' }]);
  assert.deepEqual(run.exclusions, [{ ...identity('t', 'good'), reason: 'explicit_inactive' }]);
});

test('invalid path identities are refused before any business-scoped read', async () => {
  for (const bizId of ['a/b', 'a:b', 'a.b', 'a#b', 'a$b', 'a[b', 'a]b', 'x'.repeat(129)]) {
    const db = installDb(makeDb());
    db.seed('tenants/t/app/business', { _v: JSON.stringify([{ id: bizId, name: 'Wrong node' }]) });
    db.seed('tenants/t/biz:a/b:entries', { _v: '[]' });
    const readPaths = [];
    const prior = db.ref;
    db.ref = (path, query) => { readPaths.push(path); return prior(path, query); };
    await assert.rejects(() => buildSnapshotForBiz('t', bizId, { nowMs: NOW }), /invalid_business_identity/);
    assert.deepEqual(readPaths, [], bizId);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'incomplete');
    assert.deepEqual(run.expectedBusinesses, []);
    assert.deepEqual(run.snapshots, []);
    assert.equal(readPaths.some((path) => path.startsWith('tenants/t/biz:')), false, bizId);
  }
});

test('the approved shared identity accepts exact padded business and colon or padded tenant keys', async () => {
  for (const [tenant, biz] of [['t:1', ' a'], [' t1', 'b']]) {
    const db = installDb(makeDb());
    seedBusiness(db, { tenant, biz, entries: null, businesses: [{ id: biz, name: 'Exact name' }] });
    const readPaths = [];
    const prior = db.ref;
    db.ref = (path, query) => { readPaths.push(path); return prior(path, query); };
    const direct = await buildSnapshotForBiz(tenant, biz, { nowMs: NOW });
    assert.deepEqual([direct.tenantId, direct.bizId, direct.bizName], [tenant, biz, 'Exact name']);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'complete');
    assert.deepEqual(run.expectedBusinesses, [identity(tenant, biz)]);
    assert.deepEqual(run.snapshots.map(({ tenantId, bizId, bizName }) => [tenantId, bizId, bizName]), [[tenant, biz, 'Exact name']]);
    assert.ok(readPaths.includes(`tenants/${tenant}/biz:${biz}:entries`), 'only the exact business node is read');
    assert.equal(readPaths.some((path) => path.includes(`tenants/${tenant.trim()}/biz:${biz.trim()}:entries`) && path !== `tenants/${tenant}/biz:${biz}:entries`), false);
  }
});

test('shared identity refuses unsafe tenant paths and padded twins before financial reads', async () => {
  const db = installDb(makeDb());
  const reads = [];
  const prior = db.ref;
  db.ref = (path, query) => { reads.push(path); return prior(path, query); };
  await assert.rejects(() => buildSnapshotForBiz('t/unsafe', 'a', { nowMs: NOW }), /invalid_business_identity/);
  assert.deepEqual(reads, []);
  for (const rows of [[{ id: ' a', name: 'Padded' }, { id: 'a', name: 'Plain' }],
    [{ id: 'a', name: 'Plain' }, { id: ' a', name: 'Padded' }]]) {
    const isolated = installDb(makeDb());
    seedBusiness(isolated, { tenant: 't', biz: ' a', entries: null, businesses: rows });
    const businessReads = [];
    const ref = isolated.ref;
    isolated.ref = (path, query) => { businessReads.push(path); return ref(path, query); };
    await assert.rejects(() => buildSnapshotForBiz('t', ' a', { nowMs: NOW }), /ambiguous_business_identity/);
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.status, 'incomplete');
    assert.deepEqual(run.snapshots, []);
    assert.ok(run.failedBuilds.some((f) => f.tenantId === 't' && f.bizId === ' a' && f.code === 'ambiguous_business_identity'));
    assert.equal(businessReads.some((path) => path.startsWith('tenants/t/biz: a:')), false);
  }
});

test('padded and numeric twins refuse the exact target in either record order before financial reads', async () => {
  for (const [target, twin] of [['a', ' a'], ['5', 5]]) {
    for (const rows of [[{ id: target, name: 'Exact' }, { id: twin, name: 'Alias' }],
      [{ id: twin, name: 'Alias' }, { id: target, name: 'Exact' }]]) {
      const db = installDb(makeDb());
      seedBusiness(db, { tenant: 't', biz: target, entries: null, businesses: rows });
      const readPaths = [];
      const prior = db.ref;
      db.ref = (path, query) => { readPaths.push(path); return prior(path, query); };
      await assert.rejects(() => buildSnapshotForBiz('t', target, { nowMs: NOW }), /ambiguous_business_identity/);
      assert.equal(readPaths.some((path) => path.startsWith(`tenants/t/biz:${target}:`)), false);
      const run = await buildSnapshotRun({ nowMs: NOW });
      assert.deepEqual(run.snapshots, []);
      const expectedIds = typeof twin === 'string' ? [target, twin].sort() : [target];
      assert.deepEqual(run.failedBuilds.map((f) => f.bizId).sort(), expectedIds);
      assert.ok(run.failedBuilds.every((f) => f.tenantId === 't' && f.code === 'ambiguous_business_identity'));
      assert.equal(run.status, 'incomplete');
    }
  }
});

test('different legal tenant and business pairs cannot collide in discovery', async () => {
  const db = installDb(makeDb());
  seedBusiness(db, { tenant: 't|x', biz: 'y', entries: null });
  seedBusiness(db, { tenant: 't', biz: 'x|y', entries: null });
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(run.status, 'complete');
  assert.deepEqual(run.expectedBusinesses, [identity('t|x', 'y'), identity('t', 'x|y')]);
  assert.deepEqual(run.snapshots.map(({ tenantId, bizId }) => [tenantId, bizId]), [['t|x', 'y'], ['t', 'x|y']]);
});

test('an unrelated malformed registry entry does not hide a uniquely registered target', async () => {
  const db = installDb(makeDb());
  seedBusiness(db, { tenant: 't', biz: 'good', entries: null, businesses: [7, { id: 'good', name: 'Good' }] });
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(run.status, 'incomplete');
  assert.deepEqual(run.expectedBusinesses, [identity('t', 'good')]);
  assert.deepEqual(run.snapshots.map(({ bizId }) => bizId), ['good']);
  assert.deepEqual(run.discovery.failures, [{ source: 'app_business', code: 'malformed_entry' }]);
});

test('a path-unsafe tenant key is reported while a separate valid tenant still builds', async () => {
  const db = installDb(makeDb());
  db.seed('tenants', { 'bad#tenant': { app: { business: { _v: JSON.stringify([{ id: 'hidden', name: 'Hidden' }]) } } } });
  seedBusiness(db, { tenant: 'good', biz: 'visible', entries: null });
  const readPaths = [];
  const prior = db.ref;
  db.ref = (path, query) => { readPaths.push(path); return prior(path, query); };
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.equal(run.status, 'incomplete');
  assert.deepEqual(run.discovery.failures, [{ source: 'app_business', code: 'malformed_entry' }]);
  assert.deepEqual(run.expectedBusinesses, [identity('good', 'visible')]);
  assert.deepEqual(run.snapshots.map(({ tenantId, bizId }) => [tenantId, bizId]), [['good', 'visible']]);
  assert.deepEqual(run.failedBuilds, []);
  assert.equal(readPaths.some((path) => path.startsWith('tenants/bad#tenant/')), false);
});

test('an active expected identity removes a stale exclusion for that identity only', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a']);
  db.seed('proactive_biz_index', { 'tenantA:a': false, 'tenantA:b': false });
  const run = await buildSnapshotRun({ nowMs: NOW });
  assert.deepEqual(run.expectedBusinesses, [identity('tenantA', 'a')]);
  assert.deepEqual(run.exclusions, [{ ...identity('tenantA', 'b'), reason: 'explicit_inactive' }]);
});

test('private build failure diagnostics never enter logs or handoff', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['bad']);
  failReads(db, [['tenantA', 'bad']], 'private@example.test token=secret');
  const lines = [];
  const prior = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    const run = await buildSnapshotRun({ nowMs: NOW });
    assert.equal(run.failedBuilds[0].code, 'snapshot_build_failed');
    assert.doesNotMatch(JSON.stringify(run), /private@example|secret/);
    assert.doesNotMatch(lines.join('\n'), /private@example|secret/);
  } finally { console.error = prior; }
});


test('whole run reads the clock once across multiple businesses; injected clock reads none', async () => {
  const db = installDb(makeDb());
  seed(db, 'tenantA', ['a', 'b']);
  const prior = Date.now;
  let calls = 0;
  Date.now = () => { calls += 1; return NOW; };
  try {
    const run = await buildSnapshotRun();
    assert.equal(calls, 1);
    assert.equal(run.businessDate, DATE);
    assert.ok(run.snapshots.every((snapshot) => snapshot.date === DATE));
    calls = 0;
    await buildSnapshotRun({ nowMs: NOW });
    assert.equal(calls, 0);
  } finally { Date.now = prior; }
});


test('no-eligible run date follows Israel midnight in summer and winter', async () => {
  installDb(makeDb());
  for (const [nowMs, date] of [
    [Date.UTC(2026, 8, 28, 20, 59), '2026-09-28'],
    [Date.UTC(2026, 8, 28, 21, 0), '2026-09-29'],
    [Date.UTC(2026, 10, 30, 21, 59), '2026-11-30'],
    [Date.UTC(2026, 10, 30, 22, 0), '2026-12-01'],
  ]) {
    const result = await buildSnapshotRun({ nowMs });
    assert.equal(result.businessDate, date);
    assert.equal(result.status, 'complete');
  }
});
