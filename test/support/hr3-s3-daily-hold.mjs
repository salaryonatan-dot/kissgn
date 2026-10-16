import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const record=JSON.parse(readFileSync(new URL('./hr3-s3-daily-hold.json',import.meta.url),'utf8'));
export const HR3S3_PARENT='f4fa07619d8389f0b45c196d2f76a5f6cbe97f6d';
// Scope is fixed here; a changed JSON record cannot widen it.
export const HR3S3_SCOPE=Object.freeze([
 'api/daily-snapshot/run.ts','lib/emailDelivery.js',
 'test/delivery/hr3-s2-protocol.test.mjs','test/delivery/hr3-s3-review-closure.test.mjs',
 'test/emulator/hr3-s3-roundtrip-emulator.mjs',
 'test/finance/b2-snapshot.test.mjs','test/finance/b2-guard-mutations.test.mjs','test/finance/hr3-s2-daily-hold-guard.test.mjs','test/finance/hr3-s3-daily-hold-guard.test.mjs',
 'test/support/hr3-rtdb-hold-model.mjs','test/support/hr3-s3-daily-hold.mjs','test/support/m1-r1-remediation.mjs',
]);
export const HR3S3_PINS=Object.freeze(record.pins);
export function isHR3S3Tree(repo){return gitIn(repo,['merge-base','--is-ancestor',HR3S3_PARENT,'HEAD']).status===0 && gitIn(repo,['rev-parse','HEAD']).stdout.trim()!==HR3S3_PARENT;}
export function deriveHR3S3(repo,file,edits=record.edits){
 const r=gitIn(repo,['cat-file','blob',`${HR3S3_PARENT}:${file}`]);if(r.status!==0)return {ok:false,reason:'missing_parent_blob'};
 let s=r.stdout;if(!edits[file]?.length)return {ok:false,reason:'missing_edits'};
 for(const e of edits[file]){if(!e.from||typeof e.to!=='string'||s.split(e.from).length!==2)return {ok:false,reason:'edit_anchor_not_unique'};s=s.replace(e.from,()=>e.to);}
 return {ok:true,bytes:Buffer.from(s)};
}
