// M1-A1 inspection composition. PROPOSED technical carriage, not integration/release acceptance.
import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { untrackedPaths, bf2RecordVerdict, BF2_PIN, BF2_FILE } from './bf2-backfill-layer.mjs';

export const A1_PARENT = 'f34eec92aed4851c2da8a8dfd8f1f353b1d582d7';
export const A1_SOURCES = Object.freeze({ c07t:'7062046c0227a3647fbd034e83c9bcff937e79f6', cc2:'838b63659596cd995331bbf8c681e6ad12cf1ec1', bf3:'3a3b6ff21632d76563eae95c6a8717e1cc263f76', dt:'7b1d3061c1a42b2d05d7702fbe376f98916e2ce6' });
export const A2_PARENT = 'a5f9f1b471e9d7004aba3dec923f717dbfe36c3e';
export const A2_SCOPE = Object.freeze(["test/finance/adb06-builder-layer-guard.test.mjs", "test/finance/bf1-backfill-layer-guard.test.mjs", "test/finance/cc1-checklist-cold-cache-guard.test.mjs", "test/finance/hr1-daily-hold-guard.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
// M1-A3: bounded policy-carriage successor of A2 (proposal T-A3-*). DP4 is a provenance reference, never an ancestor.
export const A3_PARENT = '43387d824e539fe5233c3b4112e6bf47a80366bb';
export const A3_SOURCE = Object.freeze({ dp4:'079fe656779eb6f922d2e3bfe3a567a6a73545ef' });
export const A3_DP_CHAIN = Object.freeze(["079fe656779eb6f922d2e3bfe3a567a6a73545ef", "a125824cdf1b824da3e60c6a85f43b73d5ee4e68", "78b6f05775cdbbad8de161c1377de79aafa41e96", "b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6", "f34eec92aed4851c2da8a8dfd8f1f353b1d582d7"]);
export const A3_RUNTIME = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "tools/daily-delivery/hold.mjs"]);
export const A3_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/dp3-evidence-validation.test.mjs", "test/delivery/dp4-legacy-date-scope.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs", "test/emulator/dp1-manual-policy-emulator.mjs", "test/emulator/dp2-admission-worker.mjs", "test/emulator/dp2-shared-admission-emulator.mjs", "test/emulator/dp3-evidence-emulator.mjs", "test/emulator/hr1-daily-hold-emulator.mjs", "test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/dp1-daily-policy-guard.test.mjs", "test/finance/dp2-daily-policy-guard.test.mjs", "test/finance/dp3-daily-policy-guard.test.mjs", "test/finance/dp4-daily-policy-guard.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/support/dp1-daily-policy.json", "test/support/dp1-daily-policy.mjs", "test/support/dp2-daily-policy.json", "test/support/dp2-daily-policy.mjs", "test/support/dp3-daily-policy.json", "test/support/dp3-daily-policy.mjs", "test/support/dp4-daily-policy.json", "test/support/dp4-daily-policy.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs", "test/support/m1-r1-remediation.mjs", "tools/daily-delivery/hold.mjs"]);
export const A3_EDITED = Object.freeze(["test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/support/m1-r1-remediation.mjs"]);
export const A3_POLICY_PIN_FILES = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/dp3-evidence-validation.test.mjs", "test/delivery/dp4-legacy-date-scope.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs", "test/emulator/dp1-manual-policy-emulator.mjs", "test/emulator/dp2-admission-worker.mjs", "test/emulator/dp2-shared-admission-emulator.mjs", "test/emulator/dp3-evidence-emulator.mjs", "test/emulator/hr1-daily-hold-emulator.mjs", "test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/dp1-daily-policy-guard.test.mjs", "test/finance/dp2-daily-policy-guard.test.mjs", "test/finance/dp3-daily-policy-guard.test.mjs", "test/finance/dp4-daily-policy-guard.test.mjs", "test/finance/hr3-ot4-daily-hold-guard.test.mjs", "test/support/dp1-daily-policy.mjs", "test/support/dp2-daily-policy.mjs", "test/support/dp3-daily-policy.mjs", "test/support/dp4-daily-policy.mjs", "test/support/m1-r1-remediation.mjs", "tools/daily-delivery/hold.mjs"]);
// M1-A3-T1: test-only successor of accepted A3 (PROPOSED). No runtime, Rules, release-pin, dependency or lockfile change.
export const A3T1_PARENT = '2dae86d4c8362212cd7633f05156a257adca7419';
export const A3T1_SCOPE = Object.freeze(["test/emulator/de1-r1-receipt-emulator.mjs", "test/emulator/de1-r2-receipt-emulator.mjs", "test/emulator/dp4-legacy-date-emulator.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const A3T1_EDITED = Object.freeze(["test/emulator/de1-r1-receipt-emulator.mjs", "test/emulator/de1-r2-receipt-emulator.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
// N22: exact configuration-only child of accepted T1; historical predicates stay unchanged.
export const N22_PARENT = "0c70b41209ed2388e1cd2dea911657ab7e620b2a";
export const N22_SCOPE = Object.freeze(["package-lock.json", "package.json", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const N22_EDITED = Object.freeze(["package-lock.json", "package.json", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
// PBN: the accepted PBD fixture row (UC2-P-01, T-PBD-ROW/T-PBD-ASSERT) carried onto exact N22. Test-only; no UC2 ancestry,
// UC2 runtime or UC2-bound carriage. The accepted source commits are provenance data only, never required objects.
export const PBN_PARENT = "e9d9566c1fb1802cef158c05991d7d47d8c9182f";
export const PBN_FIXTURE = "test/analytics/entries-reader-decimal-aggregation.test.mjs";
export const PBN_FIXTURE_PIN = "b611191b31cb1293e9dbffeb25dbce6308497fbe";
export const PBN_SOURCE = Object.freeze({ fixture:"9550569f0bdc9b6a1ff88e3ff95cc3253285291c", carriage:"7ae41336b7c2f02b953b9267768b90f97e39278f", uc2:"46e17525e88af9da357b72c5624fe5bfdc0608ce" });
export const PBN_SCOPE = Object.freeze(["test/analytics/entries-reader-decimal-aggregation.test.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const PBN_EDITED = Object.freeze(["test/analytics/entries-reader-decimal-aggregation.test.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
export const SERVER_RECIPIENT_PARENT = "d963532287f5390df9baef5c7a18a109400233b8";
export const SERVER_RECIPIENT_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "docs/production-readiness/daily-recipients-1.0.md", "docs/production-readiness/daily-recipients.example.json", "src/server/dailyRecipientConfig.ts", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/daily-recipient-server-config.test.mjs", "test/delivery/de1-r1-remediation.test.mjs", "test/delivery/de1-r5-delivery.test.mjs", "test/delivery/de1-r6-provider-structure.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/i1-integration.test.mjs", "test/emulator/daily-recipient-server-config-emulator.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/daily-recipient-server-config-guard.test.mjs", "test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/support/daily-email-harness.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const SERVER_RECIPIENT_TEST_PARENT = "5ebf2b62497790035de29d2355d2b71729067b29";
export const SERVER_RECIPIENT_TEST_SCOPE = Object.freeze(["test/emulator/daily-recipient-server-config-emulator.mjs", "test/finance/daily-recipient-server-config-guard.test.mjs", "test/finance/daily-recipient-server-config-t1-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);

// Local composition: accepted sources are literal proofs, never additional parents.
export const COMBINED_PARENT = "dffe0d60f36ddca2b8f7370b10ac1e0c24d5f175";
export const COMBINED_SOURCE = "c509ba66d40cd6e09051d7adc08735a0ad9b66b5";
export const COMBINED_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "docs/production-readiness/daily-recipients-1.0.md", "docs/production-readiness/daily-recipients.example.json", "src/server/dailyRecipientConfig.ts", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/daily-recipient-server-config.test.mjs", "test/delivery/de1-r1-remediation.test.mjs", "test/delivery/de1-r5-delivery.test.mjs", "test/delivery/de1-r6-provider-structure.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/i1-integration.test.mjs", "test/emulator/daily-recipient-server-config-emulator.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/daily-recipient-server-config-guard.test.mjs", "test/finance/daily-recipient-server-config-t1-guard.test.mjs", "test/finance/marjin-1.0-composition-guard.test.mjs", "test/finance/pbn-sfd-composition-guard.test.mjs", "test/support/daily-email-harness.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const COMBINED_TRANSFERS = Object.freeze(["api/daily-snapshot/run.ts", "docs/production-readiness/daily-recipients-1.0.md", "docs/production-readiness/daily-recipients.example.json", "src/server/dailyRecipientConfig.ts", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/daily-recipient-server-config.test.mjs", "test/delivery/de1-r1-remediation.test.mjs", "test/delivery/de1-r5-delivery.test.mjs", "test/delivery/de1-r6-provider-structure.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/i1-integration.test.mjs", "test/emulator/daily-recipient-server-config-emulator.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/daily-recipient-server-config-guard.test.mjs", "test/support/daily-email-harness.mjs"]);
export const COMPOSE_PARENT = "d963532287f5390df9baef5c7a18a109400233b8";
export const COMPOSE_SOURCE = "31fb9c43505c253ce2dc8a195fc7b9b16efe4dc1";
export const COMPOSE_SCOPE = Object.freeze(["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/finance/pbn-sfd-composition-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/israel-scenario-clock.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const COMPOSE_TRANSFERS = Object.freeze(["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/support/israel-scenario-clock.mjs"]);
export const COMPOSE_EDITED = Object.freeze(["test/finance/m1-pbn-fixture-carriage-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
export const SFD_PARENT = "e9d9566c1fb1802cef158c05991d7d47d8c9182f";
export const SFD_SCOPE = Object.freeze(["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/finance/sr11-d1-clock-guard.test.mjs", "test/support/israel-scenario-clock.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const SFD_EDITED = Object.freeze(["test/analytics/entries-reader-d1-downstream.test.mjs", "test/emulator/server-readers-matrix.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
export const A1_RECORD = 'test/support/m1-a1-inspection.json';
const MODULE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const git = (root,args) => spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
const text = (root,args) => { const r=git(root,args); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
export const a1Blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const load = root => JSON.parse(readFileSync(join(root,A1_RECORD),'utf8'));
export function isA1Tree(root) {
  try { const r=load(root); return r.parent===A1_PARENT && r.status==='PROPOSED_FOR_INDEPENDENT_REVIEW' && JSON.stringify(r.sources)===JSON.stringify(A1_SOURCES); }
  catch { return false; }
}
// A3 predicate: the A1 record, extended by the exact A3 successor entry (DP layering stays off: no DP ancestry).
export function isA3Tree(root) {
  try { const r=load(root); return isA1Tree(root) && !!r.successor && r.successor.parent===A3_PARENT && JSON.stringify(r.successor.source)===JSON.stringify(A3_SOURCE); }
  catch { return false; }
}
// A3-T1 predicate: the A3 record, extended by the exact test-only successor entry.
export function isA3T1Tree(root) {
  try { const r=load(root); return isA3Tree(root) && !!r.testSuccessor && r.testSuccessor.parent===A3T1_PARENT; }
  catch { return false; }
}
// A3-local policy pins: exactly the DP1..DP4 pin-table file set, valued from the A3 record (held by verifyA1Head and A3G-*).
export function a3PolicyPins(root) {
 if(!isA3Tree(root))return {};
 const record=load(root),out={};
 for(const file of A3_POLICY_PIN_FILES){const pin=record.treePins[file];assert.match(pin,/^[a-f0-9]{40}$/);out[file]=pin;}
 return Object.freeze(out);
}
// The independent guard holds these definitions and this module's exact pin directly.
export function verifyA1Head(root=MODULE_ROOT) {
  assert.ok(isA1Tree(root),'explicit A1 record and fixed source references required');
  const r=load(root), head=text(root,['rev-parse','HEAD']);
  if(r.localComposition)return verifyLocalComposition(root,r,head);
  if(r.serverRecipientTestSuccessor)return verifyServerRecipientTestHead(root,r,head);
  if(r.serverRecipientSuccessor)return verifyServerRecipientHead(root,r,head);
  // This bounded successor changes only the four authorized consumers and the existing joint-holder support.
  if(r.successor) assert.ok(r.carriage,'A3 extends the recorded A2 carriage');
  if(r.testSuccessor) assert.ok(r.successor,'A3-T1 extends the recorded A3 successor');
  if(r.node22Successor) assert.ok(r.testSuccessor,'N22 extends the recorded T1 successor');
  if(r.pbnSuccessor) assert.ok(r.node22Successor,'PBN extends the recorded N22 successor');
  const expectedParent=r.pbnSuccessor ? PBN_PARENT : r.node22Successor ? N22_PARENT : r.testSuccessor ? A3T1_PARENT : r.successor ? A3_PARENT : r.carriage ? A2_PARENT : A1_PARENT;
  if(r.carriage) {
    assert.deepEqual(r.carriage,{parent:A2_PARENT,scope:[...A2_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A2 carriage, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A2_PARENT,r.successor?A3_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A2_SCOPE],'exact authorized successor delta');
  }
  if(r.successor) {
    const {edits,...identity}=r.successor;
    assert.deepEqual(identity,{parent:A3_PARENT,source:{...A3_SOURCE},scope:[...A3_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A3 successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A3_PARENT,r.testSuccessor?A3T1_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A3_SCOPE],'exact authorized A3 delta');
    for(let i=0;i<A3_DP_CHAIN.length-1;i++) assert.deepEqual(text(root,['rev-list','--parents','-n1',A3_DP_CHAIN[i]]).split(' '),[A3_DP_CHAIN[i],A3_DP_CHAIN[i+1]],'literal DP provenance chain');
    assert.equal(git(root,['merge-base','--is-ancestor',A3_SOURCE.dp4,'HEAD']).status,1,'DP4 is a provenance reference, never an ancestor');
    assert.deepEqual(Object.keys(edits).sort(),[...A3_EDITED],'fixed A3 recorded-edit set');
  }
  if(r.testSuccessor) {
    const {edits,...identity}=r.testSuccessor;
    assert.deepEqual(identity,{parent:A3T1_PARENT,kind:'test_only',scope:[...A3T1_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A3-T1 test-only successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A3T1_PARENT,r.node22Successor?N22_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A3T1_SCOPE],'exact authorized A3-T1 delta');
    assert.equal(text(root,['diff','--name-only',A3T1_PARENT,r.node22Successor?N22_PARENT:'HEAD','--','.',':!test']),'','A3-T1 changes no file outside test/');
    assert.deepEqual(Object.keys(edits).sort(),[...A3T1_EDITED],'fixed A3-T1 recorded-edit set');
  }
  if(r.node22Successor) {
    const {edits,...identity}=r.node22Successor;
    assert.deepEqual(identity,{parent:N22_PARENT,kind:'node22_configuration_only',scope:[...N22_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed N22 successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',N22_PARENT,r.pbnSuccessor?PBN_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...N22_SCOPE],'exact N22 scope');
    assert.deepEqual(Object.keys(edits).sort(),[...N22_EDITED],'exact N22 recorded-edit set');
  }
  if(r.pbnSuccessor) {
    const {edits,...identity}=r.pbnSuccessor;
    assert.deepEqual(identity,{parent:PBN_PARENT,kind:'pbd_fixture_test_carriage',source:{...PBN_SOURCE},fixture:{path:PBN_FIXTURE,pin:PBN_FIXTURE_PIN},scope:[...PBN_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed PBN carriage, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',PBN_PARENT,'HEAD','--']).split('\n').filter(Boolean).sort(),[...PBN_SCOPE],'exact PBN scope');
    assert.equal(text(root,['diff','--name-only',PBN_PARENT,'HEAD','--','.',':!test']),'','PBN changes no file outside test/');
    assert.deepEqual(Object.keys(edits).sort(),[...PBN_EDITED],'exact PBN recorded-edit set');
    for(const sha of Object.values(PBN_SOURCE)) assert.notEqual(git(root,['merge-base','--is-ancestor',sha,'HEAD']).status,0,'PBD/UC2 sources are provenance only, never ancestors');
  }
  assert.deepEqual(text(root,['rev-list','--parents','-n1','HEAD']).split(' '),[head,expectedParent],'exact sole inspection parent');
  for(const sha of Object.values(A1_SOURCES)) assert.equal(text(root,['cat-file','-t',sha]),'commit','source object required');
  const names=args=>text(root,args).split('\n').filter(Boolean).sort();
  assert.deepEqual(names(['diff','--name-only',A1_PARENT,'HEAD','--']),r.scope,'fixed committed assembly scope');
  assert.deepEqual(names(['diff','--name-only','--cached',A1_PARENT,'--']),r.scope,'fixed index assembly scope');
  assert.deepEqual(names(['diff','--name-only',A1_PARENT,'--']),r.scope,'fixed working assembly scope');
  assert.deepEqual(untrackedPaths(root),[],'all untracked paths including ignored and opaque nested repositories are accounted for');
  const tree={};
  for(const line of text(root,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)) { const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(line); assert.ok(m,line); assert.notEqual(m[1],'120000','no tracked symlink'); tree[m[3]]=m[2]; }
  delete tree[A1_RECORD];
  assert.deepEqual(tree,r.treePins,'record covers every current tracked blob except its own non-self-hash');
  const index={}; for(const row of text(root,['ls-files','--stage','-z']).split('\0').filter(Boolean)) {const m=/^\d+ ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);assert.ok(m,'unmerged index');index[m[2]]=m[1];}
  for(const [file,pin] of Object.entries(r.treePins)) {
    assert.equal(index[file],pin,file+' index');
    assert.equal(a1Blob(readFileSync(join(root,file))),pin,file+' checkout');
  }
  assert.equal(text(root,['rev-parse','HEAD:'+A1_RECORD]),text(root,['rev-parse',':'+A1_RECORD]),'record index unchanged');
  assert.equal(a1Blob(readFileSync(join(root,A1_RECORD))),text(root,['rev-parse','HEAD:'+A1_RECORD]),'record working bytes unchanged');
  // Earlier contracts remain evaluated against exact accepted T1; N22's own derivation holds every changed current blob below.
  const provenancePins=r.node22Successor ? Object.fromEntries(text(root,['ls-tree','-r','-z',N22_PARENT]).split('\0').filter(Boolean).map(row=>{const m=/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);return [m[2],m[1]];})) : tree;
  const provenancePin=file=>provenancePins[file];
  // PBN: N22's own derivation remains evaluated against the exact N22 commit; PBN's derivation holds the current blobs.
  const n22Pins=r.pbnSuccessor ? Object.fromEntries(text(root,['ls-tree','-r','-z',PBN_PARENT]).split('\0').filter(Boolean).map(row=>{const m=/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);return [m[2],m[1]];})) : tree;
  const n22Pin=file=>n22Pins[file];
  for(const [file,source] of Object.entries(r.verbatim)) assert.equal(provenancePin(file),text(root,['rev-parse',source+':'+file]),file+' attributed exact source');
  for(const [file,edits] of Object.entries(r.derivations)) {
    let s=spawnSync('git',['-C',root,'show',A1_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits) { assert.ok(e.from && s.split(e.from).length===2,file+' unique edit anchor'); s=s.replace(e.from,()=>e.to); }
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' recorded parent derivation');
  }
  if(r.carriage) for(const [file,edits] of Object.entries(r.legacyEdits)) {
    let s=spawnSync('git',['-C',root,'show',A2_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique legacy edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact authorized legacy derivation');
  }
  if(r.successor) for(const [file,{base,edits}] of Object.entries(r.successor.edits)) {
    assert.ok(base===A3_PARENT||base===A3_SOURCE.dp4,file+' fixed A3 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique A3 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact A3 derivation');
  }
  if(r.testSuccessor) for(const [file,{base,edits}] of Object.entries(r.testSuccessor.edits)) {
    assert.equal(base,A3T1_PARENT,file+' fixed A3-T1 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique A3-T1 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact A3-T1 derivation');
  }
  if(r.node22Successor) for(const [file,{base,edits}] of Object.entries(r.node22Successor.edits)) {
    assert.equal(base,N22_PARENT,file+' fixed N22 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique N22 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),n22Pin(file),file+' exact N22 derivation');
  }
  if(r.pbnSuccessor) for(const [file,{base,edits}] of Object.entries(r.pbnSuccessor.edits)) {
    assert.equal(base,PBN_PARENT,file+' fixed PBN derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique PBN edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),tree[file],file+' exact PBN derivation');
  }
  if(r.pbnSuccessor) assert.equal(tree[PBN_FIXTURE],PBN_FIXTURE_PIN,'the accepted PBD fixture bytes');
  return {ok:true,head,files:Object.keys(tree).length};
}

// Explicit recipient policy layer: exact PBN parent and complete current coverage; source history stays literal.
// T1 test-only layer: exact 5ebf parent; complete protected bytes and literal source proof.
let serverRecipientTestParentProven=false;
function verifyServerRecipientTestHead(root,r,head) {
 const {edits,...identity}=r.serverRecipientTestSuccessor;
 assert.deepEqual(identity,{parent:SERVER_RECIPIENT_TEST_PARENT,kind:'server_recipient_probe_t1_only',scope:[...SERVER_RECIPIENT_TEST_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'});
 assert.deepEqual(text(root,['rev-list','--parents','-n1','HEAD']).split(' '),[head,SERVER_RECIPIENT_TEST_PARENT],'exact T1 sole parent');
 const names=args=>text(root,args).split('\n').filter(Boolean).sort();
 for(const args of [['diff','--name-only',SERVER_RECIPIENT_TEST_PARENT,'HEAD','--'],['diff','--name-only','--cached',SERVER_RECIPIENT_TEST_PARENT,'--'],['diff','--name-only',SERVER_RECIPIENT_TEST_PARENT,'--']])assert.deepEqual(names(args),[...SERVER_RECIPIENT_TEST_SCOPE],'exact T1 HEAD/index/checkout scope');
 assert.deepEqual(untrackedPaths(root),[],'untracked paths');
 const prior=JSON.parse(git(root,['show',SERVER_RECIPIENT_TEST_PARENT+':'+A1_RECORD]).stdout);
 for(const key of Object.keys(prior))if(!['treePins','scope','allowedScope','historicalGuards'].includes(key))assert.deepEqual(r[key],prior[key],key+' prior exact');
 assert.deepEqual(Object.keys(r).sort(),[...Object.keys(prior),'serverRecipientTestSuccessor'].sort());
 assert.deepEqual(r.scope,[...new Set([...prior.scope,...SERVER_RECIPIENT_TEST_SCOPE])].sort());assert.deepEqual(r.allowedScope,[...new Set([...prior.allowedScope,...r.scope])].sort());
 assert.deepEqual(r.historicalGuards,{...prior.historicalGuards,'test/finance/daily-recipient-server-config-guard.test.mjs':SERVER_RECIPIENT_TEST_PARENT});
 const tree={};for(const row of text(root,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)){const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);assert.notEqual(m[1],'120000');tree[m[3]]=m[2];}
 delete tree[A1_RECORD];assert.deepEqual(tree,r.treePins,'complete T1 tree');
 const index={};for(const row of text(root,['ls-files','--stage','-z']).split('\0').filter(Boolean)){const m=/^\d+ ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);assert.ok(m);index[m[2]]=m[1];}
 for(const [f,pin]of Object.entries(tree)){assert.equal(index[f],pin,f+' index');assert.equal(a1Blob(readFileSync(join(root,f))),pin,f+' checkout');}
 assert.equal(index[A1_RECORD],text(root,['rev-parse','HEAD:'+A1_RECORD]));assert.equal(a1Blob(readFileSync(join(root,A1_RECORD))),index[A1_RECORD]);
 const added=['test/finance/daily-recipient-server-config-t1-guard.test.mjs'];
 assert.deepEqual(Object.keys(edits).sort(),SERVER_RECIPIENT_TEST_SCOPE.filter(f=>f!==A1_RECORD&&!added.includes(f)),'closed T1 derivation set');
 for(const [f,changes]of Object.entries(edits)){let bytes=git(root,['show',SERVER_RECIPIENT_TEST_PARENT+':'+f]).stdout;for(const e of changes){assert.ok(e.from&&bytes.split(e.from).length===2,f+' unique anchor');bytes=bytes.replace(e.from,()=>e.to);}assert.equal(a1Blob(Buffer.from(bytes)),tree[f],f+' exact T1 derivation');}
 for(const [f,pin]of Object.entries(prior.treePins))if(!SERVER_RECIPIENT_TEST_SCOPE.includes(f))assert.equal(tree[f],pin,f+' protected prior');
 if(!serverRecipientTestParentProven){const view=sourceView(root,SERVER_RECIPIENT_TEST_PARENT),env={...process.env};delete env.NODE_TEST_CONTEXT;const code='import {verifyA1Head} from '+JSON.stringify(new URL('test/support/m1-a1-inspection.mjs','file://'+view+'/').href)+';verifyA1Head('+JSON.stringify(view)+');';const p=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});assert.equal(p.status,0,'literal 5ebf/PBN/N22 proof\n'+p.stdout+'\n'+p.stderr);serverRecipientTestParentProven=true;}
 return {ok:true,head,files:Object.keys(tree).length};
}

let serverRecipientParentProven=false;
function verifyServerRecipientHead(root,r,head) {
 const {edits,...identity}=r.serverRecipientSuccessor;
 assert.deepEqual(identity,{parent:SERVER_RECIPIENT_PARENT,kind:'server_only_daily_recipient',scope:[...SERVER_RECIPIENT_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'});
 assert.deepEqual(text(root,['rev-list','--parents','-n1','HEAD']).split(' '),[head,SERVER_RECIPIENT_PARENT],'exact recipient sole parent');
 const names=args=>text(root,args).split('\n').filter(Boolean).sort();
 for(const args of [['diff','--name-only',SERVER_RECIPIENT_PARENT,'HEAD','--'],['diff','--name-only','--cached',SERVER_RECIPIENT_PARENT,'--'],['diff','--name-only',SERVER_RECIPIENT_PARENT,'--']])assert.deepEqual(names(args),[...SERVER_RECIPIENT_SCOPE],'exact recipient HEAD/index/checkout scope');
 assert.deepEqual(untrackedPaths(root),[],'untracked paths');
 const prior=JSON.parse(git(root,['show',SERVER_RECIPIENT_PARENT+':'+A1_RECORD]).stdout);
 for(const key of Object.keys(prior))if(!['treePins','scope','allowedScope','historicalGuards'].includes(key))assert.deepEqual(r[key],prior[key],key+' prior exact');
 assert.deepEqual(Object.keys(r).sort(),[...Object.keys(prior),'serverRecipientSuccessor'].sort());
 assert.deepEqual(r.scope,[...new Set([...prior.scope,...SERVER_RECIPIENT_SCOPE])].sort());assert.deepEqual(r.allowedScope,[...new Set([...prior.allowedScope,...r.scope])].sort());
 assert.deepEqual(r.historicalGuards,{...prior.historicalGuards,'test/finance/m1-pbn-fixture-carriage-guard.test.mjs':SERVER_RECIPIENT_PARENT});
 const tree={};for(const row of text(root,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)){const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);assert.notEqual(m[1],'120000');tree[m[3]]=m[2];}
 delete tree[A1_RECORD];assert.deepEqual(tree,r.treePins,'complete recipient tree');
 const index={};for(const row of text(root,['ls-files','--stage','-z']).split('\0').filter(Boolean)){const m=/^\d+ ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);assert.ok(m);index[m[2]]=m[1];}
 for(const [f,pin]of Object.entries(tree)){assert.equal(index[f],pin,f+' index');assert.equal(a1Blob(readFileSync(join(root,f))),pin,f+' checkout');}
 assert.equal(index[A1_RECORD],text(root,['rev-parse','HEAD:'+A1_RECORD]));assert.equal(a1Blob(readFileSync(join(root,A1_RECORD))),index[A1_RECORD]);
 const added=["src/server/dailyRecipientConfig.ts", "docs/production-readiness/daily-recipients.example.json", "docs/production-readiness/daily-recipients-1.0.md", "test/delivery/daily-recipient-server-config.test.mjs", "test/emulator/daily-recipient-server-config-emulator.mjs", "test/finance/daily-recipient-server-config-guard.test.mjs"];
 assert.deepEqual(Object.keys(edits).sort(),SERVER_RECIPIENT_SCOPE.filter(f=>f!==A1_RECORD&&!added.includes(f)),'closed recorded derivation set');
 for(const [f,changes]of Object.entries(edits)){let bytes=git(root,['show',SERVER_RECIPIENT_PARENT+':'+f]).stdout;for(const e of changes){assert.ok(e.from&&bytes.split(e.from).length===2,f+' unique anchor');bytes=bytes.replace(e.from,()=>e.to);}assert.equal(a1Blob(Buffer.from(bytes)),tree[f],f+' exact recipient derivation');}
 for(const [f,pin]of Object.entries(prior.treePins))if(!SERVER_RECIPIENT_SCOPE.includes(f))assert.equal(tree[f],pin,f+' protected prior');
 assert.equal(tree[PBN_FIXTURE],PBN_FIXTURE_PIN);
 if(!serverRecipientParentProven){const view=sourceView(root,SERVER_RECIPIENT_PARENT),env={...process.env};delete env.NODE_TEST_CONTEXT;const code='import {verifyA1Head} from '+JSON.stringify(new URL('test/support/m1-a1-inspection.mjs','file://'+view+'/').href)+';verifyA1Head('+JSON.stringify(view)+');';const p=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});assert.equal(p.status,0,'literal PBN/N22 proof\n'+p.stdout+'\n'+p.stderr);serverRecipientParentProven=true;}
 return {ok:true,head,files:Object.keys(tree).length};
}
export function serverRecipientPolicyPins(root) { const r=load(root);return r.serverRecipientSuccessor?{'api/daily-snapshot/run.ts':r.treePins['api/daily-snapshot/run.ts']}:{}; }

// Closed current proof; every historical predicate and source holder remains literal.
const localProofs=new Set();
function verifyLocalComposition(root,r,head) {
 const {edits,...identity}=r.localComposition;
 assert.deepEqual(identity,{parent:COMBINED_PARENT,source:COMBINED_SOURCE,kind:'marjin_1_0_local_composition',scope:[...COMBINED_SCOPE],transfers:[...COMBINED_TRANSFERS],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'});
 assert.deepEqual(text(root,['rev-list','--parents','-n1','HEAD']).split(' '),[head,COMBINED_PARENT],'exact combined sole parent');
 const names=args=>text(root,args).split('\n').filter(Boolean).sort();
 for(const args of [['diff','--name-only',COMBINED_PARENT,'HEAD','--'],['diff','--name-only','--cached',COMBINED_PARENT,'--'],['diff','--name-only',COMBINED_PARENT,'--']])assert.deepEqual(names(args),[...COMBINED_SCOPE],'exact combined scope');
 assert.deepEqual(untrackedPaths(root),[],'no untracked bypass');
 const parent=JSON.parse(git(root,['show',COMBINED_PARENT+':'+A1_RECORD]).stdout),source=JSON.parse(git(root,['show',COMBINED_SOURCE+':'+A1_RECORD]).stdout);
 const cumulative=['treePins','scope','allowedScope','historicalGuards'];
 for(const prior of [parent,source])for(const k of Object.keys(prior))if(!cumulative.includes(k))assert.deepEqual(r[k],prior[k],k+' preserved source record');
 assert.deepEqual(Object.keys(r).sort(),[...new Set([...Object.keys(parent),...Object.keys(source),'localComposition'])].sort(),'closed record fields');
 assert.deepEqual(r.scope,[...new Set([...parent.scope,...source.scope,...COMBINED_SCOPE])].sort());
 assert.deepEqual(r.allowedScope,[...new Set([...parent.allowedScope,...source.allowedScope,...r.scope])].sort());
 assert.deepEqual(r.historicalGuards,{...parent.historicalGuards,...source.historicalGuards,'test/finance/pbn-sfd-composition-guard.test.mjs':COMBINED_PARENT,'test/finance/daily-recipient-server-config-t1-guard.test.mjs':COMBINED_SOURCE});
 const tree={};for(const row of text(root,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)){const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);assert.notEqual(m[1],'120000');tree[m[3]]=m[2];}
 delete tree[A1_RECORD];assert.deepEqual(tree,r.treePins,'complete current tree pins');
 const index={};for(const row of text(root,['ls-files','--stage','-z']).split('\0').filter(Boolean)){const m=/^\d+ ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);assert.ok(m,'unmerged index');index[m[2]]=m[1];}
 assert.deepEqual(Object.keys(index).sort(),[...Object.keys(tree),A1_RECORD].sort());
 for(const [f,pin]of Object.entries(tree)){assert.equal(index[f],pin,f+' index');assert.equal(a1Blob(readFileSync(join(root,f))),pin,f+' checkout');}
 assert.equal(index[A1_RECORD],text(root,['rev-parse','HEAD:'+A1_RECORD]));assert.equal(a1Blob(readFileSync(join(root,A1_RECORD))),index[A1_RECORD]);
 for(const [f,pin]of Object.entries(parent.treePins))if(!COMBINED_SCOPE.includes(f))assert.equal(tree[f],pin,f+' protected parent');
 for(const f of COMBINED_TRANSFERS)assert.equal(tree[f],source.treePins[f],f+' exact recipient transfer');
 assert.deepEqual(Object.keys(edits).sort(),['test/finance/daily-recipient-server-config-t1-guard.test.mjs','test/finance/pbn-sfd-composition-guard.test.mjs','test/support/m1-a1-inspection.mjs']);
 for(const [f,{base,edits:changes}]of Object.entries(edits)){
  assert.equal(base,f==='test/finance/pbn-sfd-composition-guard.test.mjs'?COMBINED_PARENT:COMBINED_SOURCE);
  let b=git(root,['show',base+':'+f]).stdout;
  for(const e of changes){assert.ok(e.from&&b.split(e.from).length===2,f+' unique anchor');b=b.replace(e.from,()=>e.to);}
  assert.equal(a1Blob(Buffer.from(b)),tree[f],f+' exact composition derivation');
 }
 for(const sha of [COMBINED_PARENT,COMBINED_SOURCE])if(!localProofs.has(sha)){
  const view=sourceView(root,sha),env={...process.env};delete env.NODE_TEST_CONTEXT;
  const code='import {verifyA1Head} from '+JSON.stringify(new URL('test/support/m1-a1-inspection.mjs','file://'+view+'/').href)+';verifyA1Head('+JSON.stringify(view)+');';
  const p=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',timeout:180000,maxBuffer:64*1024*1024});
  assert.equal(p.status,0,'literal accepted holder '+sha+'\n'+p.stdout+'\n'+p.stderr);localProofs.add(sha);
 }
 return {ok:true,head,files:Object.keys(tree).length};
}

// Run the unchanged assertions in an isolated literal source view. This is a local shared-object
// test fixture, not the bundle-only delivery proof. Current A1 protection is always checked first.
const views=new Map(), results=new Map();
after(()=>{ for(const dir of views.values()) rmSync(dir,{recursive:true,force:true}); });
function sourceView(root,sha) {
  if(views.has(sha)) return views.get(sha);
  const dir=mkdtempSync(join(tmpdir(),'m1-a1-history-'));
  let r=spawnSync('git',['clone','--shared','--no-checkout','--quiet',root,dir],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);
  r=spawnSync('git',['-C',dir,'checkout','--quiet','--detach',sha],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);
  for(const dep of ['node_modules','test/historical/.deps']) { const p=join(root,dep); if(existsSync(p))symlinkSync(resolve(p),join(dir,dep),'dir'); }
  views.set(sha,dir);return dir;
}
export function historicalTest(rootURL,sha,file) {
  const root=fileURLToPath(rootURL);
  if(!isA1Tree(root)) return nodeTest;
  return (title,options,fn)=> {
    if(typeof options==='function') {fn=options;options={};}
    // No A1 proof is skipped because a source-reference lane isn't an ancestor.
    return nodeTest(title, { ...options, skip:false, todo:false }, t=> {
      verifyA1Head(root);
      const key=sha+':'+file;
      if(!results.has(key)) {
        const view=sourceView(root,sha);
        const childEnv={...process.env}; delete childEnv.NODE_TEST_CONTEXT; // a fresh node:test subprocess, not a recursive inherited runner
        const r=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:view,env:childEnv,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024});
        const metrics={};for(const k of ['tests','pass','fail','skipped','cancelled','todo'])metrics[k]=Number(new RegExp('^# '+k+' (\\d+)$','m').exec(r.stdout)?.[1]??NaN);
        const titles=[...r.stdout.matchAll(/^ok \d+ - (.*)$/gm)].map(m=>m[1]);
        results.set(key,{status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,metrics,titles});
        t.diagnostic('Literal historical execution '+key+'\n'+r.stdout+'\nSTDERR\n'+r.stderr);
      }
      const r=results.get(key);
      assert.equal(r.status,0,'literal source guard must finish successfully: '+key+'\n'+r.stdout+'\n'+r.stderr);
      assert.equal(r.metrics.fail,0);assert.equal(r.metrics.skipped,0);assert.equal(r.metrics.cancelled,0);assert.equal(r.metrics.todo,0);
      assert.ok(r.metrics.pass>0);assert.ok(r.titles.includes(title),'the exact original assertion row executed: '+title);
    });
  };
}

// A1-local projection: the standalone BF2 predicate requires BF1 ancestry, which a
// content-only carry deliberately does not acquire. Preserve the exact BF2 verdict
// and script checks here; the original BF3 module and collector remain unchanged.
export function a1BackfillProjection(root, paths) {
 const all=[...new Set(paths||[])];
 if(!isA1Tree(root))return {ok:true,layered:false,projected:all};
 const verdict=bf2RecordVerdict(root);if(!verdict.ok)return verdict;
 assert.equal(BF2_PIN,'25754ea6e7f81585b0d68101da5c51ebcff6de48');
 let bytes;try{bytes=readFileSync(join(root,BF2_FILE));}catch{return {ok:false,reason:'script_missing'};}
 if(a1Blob(bytes)!==BF2_PIN)return {ok:false,reason:'script_content_mismatch'};
 if(text(root,['rev-parse','HEAD:'+BF2_FILE])!==BF2_PIN || text(root,['rev-parse',':'+BF2_FILE])!==BF2_PIN)return {ok:false,reason:'script_history_mismatch'};
 // N22's two configuration files are a separate exact-content layer, never a widened
 // reader allowlist. Both files must match HEAD, index and working bytes before either
 // is projected; without this layer they remain protected in the reader verdict.
 if(load(root).node22Successor) {
  const {edits,...identity}=load(root).node22Successor;
  if(JSON.stringify(identity)!==JSON.stringify({parent:N22_PARENT,kind:'node22_configuration_only',scope:[...N22_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'}))return {ok:false,reason:'node22_layer_identity'};
  // PBN: the N22 layer stays bound to the exact N22 commit; PBN's own exact identity and parent are required on its child.
  const combined=load(root).localComposition;
  if(combined){
   if(text(root,['rev-parse','HEAD^'])!==COMBINED_PARENT)return {ok:false,reason:'local_composition_parent'};
   verifyA1Head(root);
  }
  const probeHead=combined?COMBINED_SOURCE:'HEAD';
  const probe=load(root).serverRecipientTestSuccessor;
  if(probe){
   if(probe.parent!==SERVER_RECIPIENT_TEST_PARENT||probe.kind!=='server_recipient_probe_t1_only'||JSON.stringify(probe.scope)!==JSON.stringify([...SERVER_RECIPIENT_TEST_SCOPE]))return {ok:false,reason:'recipient_test_identity'};
   if(text(root,['rev-parse',probeHead+'^'])!==SERVER_RECIPIENT_TEST_PARENT)return {ok:false,reason:'recipient_test_parent'};
   if(text(root,['diff','--name-only',SERVER_RECIPIENT_TEST_PARENT,probeHead,'--']).split('\n').filter(Boolean).sort().join('\0')!==[...SERVER_RECIPIENT_TEST_SCOPE].join('\0'))return {ok:false,reason:'recipient_test_scope'};
  }
  const recipientHead=probe?SERVER_RECIPIENT_TEST_PARENT:'HEAD';
  const recipient=load(root).serverRecipientSuccessor;
  if(recipient){
   if(recipient.parent!==SERVER_RECIPIENT_PARENT||recipient.kind!=="server_only_daily_recipient"||JSON.stringify(recipient.scope)!==JSON.stringify([...SERVER_RECIPIENT_SCOPE]))return {ok:false,reason:"recipient_layer_identity"};
   if(text(root,["rev-parse",recipientHead+"^"])!==SERVER_RECIPIENT_PARENT)return {ok:false,reason:"recipient_parent"};
   if(text(root,["diff","--name-only",SERVER_RECIPIENT_PARENT,recipientHead,"--"]).split("\n").filter(Boolean).sort().join("\0")!==[...SERVER_RECIPIENT_SCOPE].join("\0"))return {ok:false,reason:"recipient_scope"};
  }
  const pbn=load(root).pbnSuccessor;
  if(pbn) {
   const {edits:pe,...pid}=pbn;
   if(JSON.stringify(pid)!==JSON.stringify({parent:PBN_PARENT,kind:'pbd_fixture_test_carriage',source:{...PBN_SOURCE},fixture:{path:PBN_FIXTURE,pin:PBN_FIXTURE_PIN},scope:[...PBN_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'}))return {ok:false,reason:'pbn_layer_identity'};
   if(text(root,['rev-parse',(recipient?SERVER_RECIPIENT_PARENT:'HEAD')+'^'])!==PBN_PARENT)return {ok:false,reason:'pbn_parent'};
  }
  if(text(root,['rev-parse',(pbn?PBN_PARENT:'HEAD')+'^'])!==N22_PARENT)return {ok:false,reason:'node22_parent'};
  const pins={"package.json":"2a935d91920c71e6d1640871be54f1804f384830","package-lock.json":"c9704e950be93f24e2b0449fd0de427d0d6d4bec"};
  for(const [file,pin] of Object.entries(pins)) {
   let bytes;try{bytes=readFileSync(join(root,file));}catch{return {ok:false,reason:'node22_configuration_missing',detail:file};}
   if(a1Blob(bytes)!==pin||text(root,['rev-parse','HEAD:'+file])!==pin||text(root,['rev-parse',':'+file])!==pin)return {ok:false,reason:'node22_configuration_mismatch',detail:file};
  }
  return {ok:true,layered:true,layer:'A1-exact-BF3+N22',projected:all.filter(f=>f!==BF2_FILE&&!Object.hasOwn(pins,f))};
 }
 return {ok:true,layered:true,layer:'A1-exact-BF3',projected:all.filter(f=>f!==BF2_FILE)};
}

// Fixed assembly-local table: only support files already pinned by the inherited
// M1/hold tables may move here. Their content is held by the full A1 record and guard.
export const A1_LOCAL_PIN_FILES = Object.freeze([
 'test/finance/b2-guard-mutations.test.mjs',
 'test/support/m1-r1-remediation.mjs',
 'test/finance/hr3-ot4-daily-hold-guard.test.mjs',
]);
export function a1LocalPins(root) {
 if(!isA1Tree(root))return {};
 const record=load(root),out={};
 for(const file of A1_LOCAL_PIN_FILES){const pin=record.treePins[file];assert.match(pin,/^[a-f0-9]{40}$/);out[file]=pin;}
 return Object.freeze(out);
}
