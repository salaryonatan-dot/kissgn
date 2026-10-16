import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record = JSON.parse(readFileSync(new URL('./hr3-s2-daily-hold.json', import.meta.url),'utf8'));
export const HR3S2_PARENT = '83893b5fc04dc7eae85b2aa279fcfbe925f08906';
// The authorized surface is code, not a list a modified record can widen.
export const HR3S2_SCOPE = Object.freeze([
  'lib/emailDelivery.d.ts','lib/emailDelivery.js',
  'test/delivery/hr1-daily-hold.test.mjs','test/delivery/hr1-operator-and-compat.test.mjs',
  'test/delivery/hr2-review-findings.test.mjs','test/delivery/hr3-inventory-protocol.test.mjs',
  'test/delivery/hr3-s1-durability.test.mjs','test/delivery/hr3-s2-protocol.test.mjs',
  'test/emulator/hr1-daily-hold-emulator.mjs','test/finance/b2-guard-mutations.test.mjs',
  'test/finance/hr3-s1-daily-hold-guard.test.mjs','test/finance/hr3-s2-daily-hold-guard.test.mjs',
  'test/support/hr3-s2-daily-hold.mjs','test/support/m1-r1-remediation.mjs','tools/daily-delivery/hold.mjs',
]);
export const HR3S2_PINS = Object.freeze(record.pins);
export function deriveHR3S2(repo,file,edits=record.edits) {
  const parent=gitIn(repo,['cat-file','blob',`${HR3S2_PARENT}:${file}`]);
  if(parent.status!==0)return {ok:false,reason:'missing_parent_blob'};
  let text=parent.stdout;
  if(!Array.isArray(edits?.[file]) || !edits[file].length)return {ok:false,reason:'missing_edits'};
  for(const e of edits[file]){
    if(typeof e.from!=='string'||!e.from||typeof e.to!=='string'||text.split(e.from).length!==2)
      return {ok:false,reason:'edit_anchor_not_unique'};
    text=text.replace(e.from,()=>e.to);
  }
  return {ok:true,bytes:Buffer.from(text)};
}
export function isHR3S2Tree(repo) {
  return gitIn(repo,['merge-base','--is-ancestor',HR3S2_PARENT,'HEAD']).status===0 &&
    gitIn(repo,['rev-parse','HEAD']).stdout.trim()!==HR3S2_PARENT;
}
