// R3 page scope (successor of the F2 page e63ba6c8:index.html, pending independent Codex review): the two
// Cost History capability checks /4 → /5, the bound history decode in finSrc, and the CostHistoryEditor's
// rejected-state handling (reject button, rejected label, re-activation over an all-rejected history).
// Full byte identity is a separate literal pin (r3-candidate-pin.mjs).
import { diffHunks } from './c1-index-scope.mjs';
const HUNKS=[[885,1],[1102,1],[5720,0],[5729,1],[5733,1],[5735,1],[5737,1],[5740,1],[5766,1],[5783,1],[5799,1],[5804,2],[5812,1],[5815,0],[5817,1],[5819,1],[5832,2],[6548,0],[6551,1]];
export function r3IndexVerdict(baseBytes,candidateBytes){
  const base=Buffer.isBuffer(baseBytes)?baseBytes.toString('utf8'):String(baseBytes);
  const next=Buffer.isBuffer(candidateBytes)?candidateBytes.toString('utf8'):String(candidateBytes);
  const hunks=diffHunks(base,next).map(h=>[h.start,h.count]);
  if(JSON.stringify(hunks)!==JSON.stringify(HUNKS))return {ok:false,reason:'r3_scope_changed',detail:hunks};
  if(!next.includes('v.costHistory !== "MARJIN_COSTH/5"')||!next.includes('api.versions.costHistory !== "MARJIN_COSTH/5"'))return {ok:false,reason:'r3_capability_missing'};
  if(!next.includes('data-f2="reject-flag"')||!next.includes('data-f2="rejected"')||!next.includes('reviewCommand("reject_flag")'))return {ok:false,reason:'r3_reject_control_missing'};
  if(!next.includes('finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, histBind)'))return {ok:false,reason:'r3_bound_decode_missing'};
  if(!next.includes('data-f2="cost-editor"')||!next.includes('financeLocked={finRaw.bizId!==currentBizId || finRaw.costHistory.kind!=="absent"}'))return {ok:false,reason:'f2_editor_gate_missing'};
  if(!next.includes('if (activating && (role!=="owner" || !activationConfirmed)) {setResult({status:"activation_confirmation_required"});return;}'))return {ok:false,reason:'r3_owner_activation_gate_missing'};
  return {ok:true};
}
