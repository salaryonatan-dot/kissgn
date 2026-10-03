// FZ-P1 supplement shape support (tests only). A frozen artifact's SHAPE is its keys and their types —
// never its values — merged over representative fixtures: a key only some states carry is optional
// ("key?"); a field of several types is the union {"$oneOf": [...]}. Contract identifiers (versions,
// state / reason / issue codes) are frozen separately, as literal values, in each golden's "ids".
// Independent of the approved FZ helper (test/support/fz-shape.mjs, not present on this lineage) so the
// approved FZ candidate is never modified; the rendering rules are the same.
function prim(v) { if (v === null) return "null"; const t = typeof v; return t === "object" ? null : t; }
function emptyU() { return { prims: new Set(), obj: null, arr: null }; }
function add(u, v, path) {
  const p = prim(v);
  if (p !== null) { u.prims.add(p); return; }
  if (Array.isArray(v)) { if (!u.arr) u.arr = { u: null }; for (const x of v) { u.arr.u = u.arr.u || emptyU(); add(u.arr.u, x, path + "[]"); } return; }
  const proto = Object.getPrototypeOf(v);
  const plain = proto === null || proto === Object.prototype || (proto && Object.getPrototypeOf(proto) === null && proto.constructor && proto.constructor.name === "Object");
  if (!plain) throw new Error("shape: non-plain object at " + (path || "<root>"));
  if (!u.obj) u.obj = { n: 0, keys: new Map() };
  u.obj.n++;
  for (const k of Object.keys(v)) { const e = u.obj.keys.get(k) || { n: 0, u: emptyU() }; e.n++; add(e.u, v[k], path ? path + "." + k : k); u.obj.keys.set(k, e); }
}
function render(u) {
  const alts = [...u.prims].sort();
  if (u.obj) { const o = {}; for (const k of [...u.obj.keys.keys()].sort()) { const e = u.obj.keys.get(k); o[e.n < u.obj.n ? k + "?" : k] = render(e.u); } alts.push(o); }
  if (u.arr) alts.push(u.arr.u ? [render(u.arr.u)] : []);
  if (alts.length === 0) return "never";
  if (alts.length === 1) return alts[0];
  return { $oneOf: alts.map((a) => [JSON.stringify(a), a]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((x) => x[1]) };
}
/** The merged shape of a list of values (JSON projection: bigint ⇒ string, undefined keys dropped). */
export function shapeOf(values) {
  const u = emptyU();
  for (const v of values) add(u, JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x))), "");
  return render(u);
}
/** Paths where two shapes differ (empty ⇒ equal). */
export function shapeDiff(a, b, path = "") {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) return [];
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) && !a.$oneOf && !b.$oneOf) {
    const out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(path + "." + k + ": added");
      else if (!(k in b)) out.push(path + "." + k + ": removed");
      else out.push(...shapeDiff(a[k], b[k], path + "." + k));
    }
    return out;
  }
  return [path + ": " + sa.slice(0, 120) + " ≠ " + sb.slice(0, 120)];
}
