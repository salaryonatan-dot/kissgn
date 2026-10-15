// Proposed HR3 checkpoint successor; no release or independent acceptance is implied.
import { readFileSync } from 'node:fs';
import { gitIn } from './git-context.mjs';
const RECORD = JSON.parse(readFileSync(new URL('./hr3-s1-daily-hold.json', import.meta.url), 'utf8'));
export const HR3S1_PARENT = 'fd52603403eb0415d352e12d20842e4f894dea6b';
export const HR3S1_SCOPE = Object.freeze(['lib/emailDelivery.js']);
export const HR3S1_PINS = Object.freeze({...RECORD.pins});
export const HR3S1_EDITS = Object.freeze(RECORD.edits);
export function isHR3S1Tree(repo) {
  return gitIn(repo,['merge-base','--is-ancestor',HR3S1_PARENT,'HEAD']).status === 0 &&
    gitIn(repo,['rev-parse','HEAD']).stdout.trim() !== HR3S1_PARENT;
}
export function deriveHR3S1(repo,file,edits=HR3S1_EDITS) {
  const r=gitIn(repo,['cat-file','blob',`${HR3S1_PARENT}:${file}`],{encoding:'buffer'});
  if(r.status !== 0) return {ok:false,reason:'missing_parent_blob'};
  const list=edits[file]; if(!Array.isArray(list)||!list.length) return {ok:false,reason:'no_recorded_edits'};
  let text=r.stdout.toString('utf8');
  for(const e of list) {
    if(typeof e.from !== 'string'||!e.from||typeof e.to !== 'string'||text.split(e.from).length !== 2)
      return {ok:false,reason:'edit_anchor_not_unique'};
    text=text.replace(e.from,()=>e.to);
  }
  return {ok:true,bytes:Buffer.from(text,'utf8')};
}
