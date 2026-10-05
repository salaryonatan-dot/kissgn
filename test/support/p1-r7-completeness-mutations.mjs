// Run explicitly: node test/support/p1-r7-completeness-mutations.mjs <absolute log directory>
// Each disposable clone disables exactly one completeness conjunct. A targeted committed test
// must fail behaviorally after successful fincore regeneration; compilation failures do not count.
import { cpSync, mkdtempSync, symlinkSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = process.argv[2];
if (!out || !out.startsWith('/')) throw new Error('absolute log directory required');
mkdirSync(out, { recursive: true });
const file = 'src/finance/supplierCredits.ts';
const cases = [
  ['a-record-review', 'if (lineageRecords.some(([, r]) => typeof r.operationId !== "string" || !reviews.has(r.operationId))) untrustedDates.add(lid);', 'a record review'],
  ['b-event-review', 'if (lineageEvents.some(([operationId]) => !reviews.has(operationId))) untrustedDates.add(lid);', 'b event review'],
  ['c-referenced-record', 'if (references.some((creditId) => typeof creditId !== "string" || !recordIds.has(creditId))) untrustedDates.add(lid);', 'c referenced record'],
  ['d-head-sequence', 'if (!isPlainObject(head) || !exactKeys(head, ["creditId", "seq"]) || head.seq !== operationIds.size) untrustedDates.add(lid);', 'd head sequence'],
];
const result = [];
for (const [id, original, target] of cases) {
  const dir = mkdtempSync(join(tmpdir(), `p1-r7-${id}-`));
  cpSync(root, dir, { recursive: true, filter: p => !['.git', 'node_modules', '.deps'].includes(p.split('/').at(-1)) });
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const path = join(dir, file);
  const before = readFileSync(path, 'utf8');
  if (before.split(original).length !== 2) throw new Error(`${id}: mutation anchor missing or duplicated`);
  const replacement = 'if (false) untrustedDates.add(lid);';
  writeFileSync(path, before.replace(original, replacement));
  const regen = spawnSync(process.execPath, ['tools/finance-core/gen-browser.mjs'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  writeFileSync(join(out, `${id}-regen.log`), regen.stdout + regen.stderr);
  if (regen.status !== 0) throw new Error(`${id}: mutant did not compile`);
  const test = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=R7 completeness guard ${target}`,
    'test/finance/p1-r7-lineage-completeness.test.mjs'], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 8e6 });
  writeFileSync(join(out, `${id}.log`), test.stdout + test.stderr);
  const detected = test.status === 1 && test.stdout.includes(`not ok`) && test.stdout.includes(target) &&
    /purchases must be incomplete|untrusted chain dates/.test(test.stdout) && !/SyntaxError/.test(test.stdout);
  result.push({ id, original, replacement, target, detected, exit: test.status, clone: dir });
  console.log(`${id}: ${detected ? 'DETECTED' : 'SURVIVED'}`);
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(result, null, 2));
if (result.some(r => !r.detected)) process.exitCode = 1;
