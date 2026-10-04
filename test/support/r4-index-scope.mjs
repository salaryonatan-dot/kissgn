// Core/F1 R4 page scope (successor of the REJECTED R3 page 950045c6:index.html, pending independent Codex
// review): the two Cost History capability checks /5 → /6, the MarjinC1 `historyBinding` seam, the finRaw
// subscription held WITH its verified selection context (tenant, business, generation) and re-bound on every
// generation bump, the finSrc decode BOUND through historyBinding (unavailable without a verified tenant +
// registered business; never the global tenant variable), and the CostHistoryEditor's canonical lifecycle
// (accepted = cleared + decision audit accepted; owner-only decision / re-activation controls; bound decode;
// context_unbound unavailable). Full byte identity is a separate literal pin (r4-candidate-pin.mjs).
import { diffHunks } from './c1-index-scope.mjs';
const HUNKS=[[885,1],[1102,1],[1132,0],[1858,1],[5726,0],[5727,0],[5730,1],[5810,2],[5819,0],[5825,1],[6468,1],[6470,3],[6473,0],[6475,1],[6495,1],[6524,1],[6557,5],[6563,1],[7707,1],[9312,1]];
const REQUIRED=[
  ['r4_capability_missing','v.costHistory !== "MARJIN_COSTH/6"'],
  ['r4_capability_missing','api.versions.costHistory !== "MARJIN_COSTH/6"'],
  ['r4_history_binding_missing','function historyBinding(raw, sel, currentBizId, businesses) {'],
  ['r4_history_binding_missing','      if (!bound) return { ok: false, reason: "context_unbound" };'],
  ['r4_history_binding_missing','      if (!registered) return { ok: false, reason: "business_unregistered" };'],
  ['r4_history_binding_missing','historyBinding: historyBinding,'],
  ['r4_bound_decode_missing','const histBind = window.MarjinC1.historyBinding(finRaw, finSel, currentBizId, businesses);'],
  ['r4_bound_decode_missing','      : !histBind.ok ? { state: "unreadable", reason: histBind.reason }'],
  ['r4_bound_decode_missing','finF.costHistory.codec.decodeHistory({ failed: "read_failed" }, histBind.bind)'],
  ['r4_bound_decode_missing','finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, histBind.bind)'],
  ['r4_subscription_binding_missing','  }, [currentBizId, finSel.gen, finSel.tenantId]);'],
  ['r4_subscription_binding_missing','setFinRaw({ config: FIN_NODE_LOADING, fixed: FIN_NODE_LOADING, costHistory: FIN_NODE_LOADING, bizId: currentBizId || null, tenantId: bound ? ctx.tenantId : null, gen: bound ? ctx.gen : null });'],
  ['r4_subscription_binding_missing','setFinRaw(prev => (prev.bizId === currentBizId && prev.tenantId === ctx.tenantId && prev.gen === ctx.gen ? { ...prev, [name]: v } : prev))'],
  ['r4_editor_binding_missing','    : !bound ? {state:"unreadable",reason:"context_unbound"}'],
  ['r4_editor_binding_missing','    : codec.decodeHistoryStructure({exists:node.kind === "raw",value:node.raw},{tenantId,bizId});'],
  ['r4_editor_lifecycle_missing','{review?.state==="cleared"&&review?.decision==="accepted"&&<p data-f2="accepted">'],
  ['r4_editor_lifecycle_missing','{activating&&role!=="owner"&&<p data-f2="activation-owner-only">'],
  ['r4_editor_lifecycle_missing','{(activating?role==="owner":state.state==="present"&&!unresolved)&&draft&&<>'],
  ['r4_editor_lifecycle_missing','reviewCommand(review.state==="flagged"?"accept_flag":"reconcile")'],
  ['r4_editor_lifecycle_missing','data-f2="reject-flag"'],
  ['r4_editor_lifecycle_missing','reviewCommand("reject_flag")'],
  ['r4_owner_activation_gate_missing','if (activating && (role!=="owner" || !activationConfirmed)) {setResult({status:"activation_confirmation_required"});return;}'],
  ['f2_editor_gate_missing','data-f2="cost-editor"'],
  ['f2_editor_gate_missing','financeLocked={finRaw.bizId!==currentBizId || finRaw.costHistory.kind!=="absent"}'],
];
const FORBIDDEN=[
  ['r4_fifth_state_literal',/acknowledged/],
  ['r4_stale_capability_literal',/MARJIN_COSTH\/[45]"/],
  ['r4_unbound_decode',/decodeHistory\(\{ exists: raw\.costHistory\.kind !== "absent", value: raw\.costHistory\.raw \}\)/],
  ['r4_unbound_decode',/decodeHistory\(\{ exists: raw\.costHistory\.kind !== "absent", value: raw\.costHistory\.raw \}, histBind\)/],
  ['r4_global_tenant_binding',/historyBinding\([^)]*_currentTenantId/],
];
export function r4IndexVerdict(baseBytes,candidateBytes){
  const base=Buffer.isBuffer(baseBytes)?baseBytes.toString('utf8'):String(baseBytes);
  const next=Buffer.isBuffer(candidateBytes)?candidateBytes.toString('utf8'):String(candidateBytes);
  const hunks=diffHunks(base,next).map(h=>[h.start,h.count]);
  if(JSON.stringify(hunks)!==JSON.stringify(HUNKS))return {ok:false,reason:'r4_scope_changed',detail:hunks};
  for(const [reason,literal] of REQUIRED) if(!next.includes(literal))return {ok:false,reason,detail:literal};
  for(const [reason,re] of FORBIDDEN) if(re.test(next))return {ok:false,reason,detail:String(re)};
  if(next.split('historyNode={finRaw.bizId===currentBizId&&finRaw.tenantId===finSel.tenantId&&finRaw.gen===finSel.gen?finRaw.costHistory:{kind:"loading"}}').length!==3)return {ok:false,reason:'r4_editor_node_binding_missing'};
  if(next.split('tenantId={finSel.tenantId} bizId={finSel.bizId===currentBizId?currentBizId:null}').length!==3)return {ok:false,reason:'r4_editor_node_binding_missing'};
  return {ok:true};
}
