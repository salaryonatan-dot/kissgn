// FZ shape-freeze support (09_AGENT_DAILY_HANDOFF.md §2): a frozen artifact's SHAPE is its keys
// and their types — never its values. A shape is derived from live outputs of the accepted code
// over representative fixtures and merged across them, so a key that only some states carry is
// recorded as optional ("key?") and a field that is a number in one state and null in another is
// recorded as the union {"$oneOf": ["null", "number"]}.
//
//   primitive        "boolean" | "null" | "number" | "string" | "undefined" | "bigint" | "function"
//   object           { "<key>": Shape, "<optionalKey>?": Shape }   (keys sorted)
//   array            [ Shape ]  — the merged element shape;  []  — only ever empty
//   union            { "$oneOf": [ Shape, … ] }   (alternatives sorted by their JSON)
//
// Identifiers that ARE part of the contract (formula / version ids, reason codes, error codes)
// are frozen separately, as literal values, by the goldens' "ids" sections — not by shape.
const PRIM = new Set(["boolean", "null", "number", "string", "undefined", "bigint", "function", "symbol"]);

function primName(v) {
  if (v === null) return "null";
  const t = typeof v;
  return t === "object" ? null : t;
}

/** Internal union: { prims:Set<string>, obj:{n, keys:Map<k,{n,u}>}|null, arr:{u|null}|null } */
function emptyU() { return { prims: new Set(), obj: null, arr: null }; }
function addValue(u, v, path, opts) {
  const p = primName(v);
  if (p !== null) { u.prims.add(p); return u; }
  if (Array.isArray(v)) {
    if (!u.arr) u.arr = { u: null };
    for (let i = 0; i < v.length; i++) { u.arr.u = u.arr.u || emptyU(); addValue(u.arr.u, v[i], path + "[]", opts); }
    return u;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== null && proto !== Object.prototype && !(opts && opts.allowClass && opts.allowClass(v, path))) {
    // a value from another realm (vm) is still a plain object if its prototype's prototype is null
    const plainOtherRealm = proto && Object.getPrototypeOf(proto) === null && proto.constructor && proto.constructor.name === "Object";
    if (!plainOtherRealm) throw new Error(`shapeOf: non-plain object at ${path || "<root>"} (${proto && proto.constructor ? proto.constructor.name : "?"})`);
  }
  if (!u.obj) u.obj = { n: 0, keys: new Map() };
  u.obj.n++;
  for (const k of Object.keys(v)) {
    const e = u.obj.keys.get(k) || { n: 0, u: emptyU() };
    e.n++; addValue(e.u, v[k], path ? path + "." + k : k, opts);
    u.obj.keys.set(k, e);
  }
  return u;
}
function render(u) {
  const alts = [...u.prims].sort();
  if (u.obj) {
    const o = {};
    for (const k of [...u.obj.keys.keys()].sort()) {
      const e = u.obj.keys.get(k);
      o[e.n < u.obj.n ? k + "?" : k] = render(e.u);
    }
    alts.push(o);
  }
  if (u.arr) alts.push(u.arr.u ? [render(u.arr.u)] : []);
  if (alts.length === 0) return "never";
  if (alts.length === 1) return alts[0];
  return { $oneOf: alts.map((a) => [JSON.stringify(a), a]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((x) => x[1]) };
}

/** The merged shape of one or more sample values. */
export function shapeOf(samples, opts) {
  const u = emptyU();
  for (const s of samples) addValue(u, s, "", opts);
  return render(u);
}

/** Every difference between a frozen shape and a live shape, as readable paths (empty = equal). */
export function shapeDiff(frozen, live, path = "") {
  const out = [];
  const isObj = (s) => s && typeof s === "object" && !Array.isArray(s) && !("$oneOf" in s);
  const J = (s) => JSON.stringify(s);
  if (J(frozen) === J(live)) return out;
  if (isObj(frozen) && isObj(live)) {
    const strip = (k) => (k.endsWith("?") ? k.slice(0, -1) : k);
    const fk = new Map(Object.keys(frozen).map((k) => [strip(k), k])), lk = new Map(Object.keys(live).map((k) => [strip(k), k]));
    for (const [b, k] of fk) if (!lk.has(b)) out.push(`${path}${b}: removed (frozen ${k.endsWith("?") ? "optional" : "required"})`);
    for (const [b, k] of lk) if (!fk.has(b)) out.push(`${path}${b}: added (${J(live[k])})`);
    for (const [b, k] of fk) {
      if (!lk.has(b)) continue;
      const l = lk.get(b);
      if (k !== l) out.push(`${path}${b}: ${k.endsWith("?") ? "optional" : "required"} → ${l.endsWith("?") ? "optional" : "required"}`);
      out.push(...shapeDiff(frozen[k], live[l], path + b + "."));
    }
    return out;
  }
  if (Array.isArray(frozen) && Array.isArray(live) && frozen.length === 1 && live.length === 1) return shapeDiff(frozen[0], live[0], path + "[].");
  out.push(`${path || "<root>"}: type ${J(frozen)} → ${J(live)}`);
  return out;
}

export { PRIM };
