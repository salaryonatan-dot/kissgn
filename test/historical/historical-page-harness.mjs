// Marjin — HISTORICAL RENDERED PAGE harness (P0-DATA-01 Version Fence R1, Gate F).
//
// Executes the ACTUAL bytes of a historical `index.html` (read from git at an exact
// SHA — never from the working tree) as a rendered page inside jsdom: the page's own
// inline scripts run in order, React 18 + Babel-standalone render its real component
// tree into `#root`, and its own `window.storage` module code (the real bytes) is
// executed with ONE substitution — the CDN Firebase SDK imports are supplied by a shim
// that routes every `ref/get/set/remove/onValue/runTransaction` call through a
// Firebase Admin SDK app carrying an ordinary-member `databaseAuthVariableOverride`,
// against the local RTDB emulator. Nothing else in the page is changed: the page's
// legacy `{_v}` transport, its coordinator, its React UI and its click handlers are
// the historical code, byte for byte.
//
// Dependencies are NOT part of package.json (package files are frozen): run
// `test/historical/install-deps.sh` once; it installs the exact versions the page
// loaded from its CDN <script> tags into `test/historical/.deps/` (git-ignored).

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { gitIn } from "../support/git-context.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(DIR, "..", "..");
export const DEPS_DIR = join(DIR, ".deps");
export const HISTORICAL_SHA = "1038b4cd199d01d0b8df599fb6d54411fbfff204";   // R10 candidate: the last all-legacy client build (pre Storage V2, pre fence)

// Exact versions the historical page pulled from its CDN tags (index.html@1038b4c lines 549-554).
export const PINNED_DEPS = { react: "18.2.0", "react-dom": "18.2.0", "prop-types": "15.8.1", "@babel/standalone": "7.23.6", jsdom: "24.1.3" };

export function depsStatus() {
  const missing = Object.keys(PINNED_DEPS).filter((p) => !existsSync(join(DEPS_DIR, "node_modules", p, "package.json")));
  return { ok: missing.length === 0, missing };
}

/** The historical page bytes, from git — the working tree is never consulted. */
export function historicalHtml(sha = HISTORICAL_SHA) {
  const show = gitIn(ROOT, ["show", `${sha}:index.html`], { maxBuffer: 64 * 1024 * 1024 });
  if (show.status !== 0) throw new Error(`cannot read index.html at ${sha}: ${show.stderr}`);
  return show.stdout;
}

/** Ordered <script> blocks of the page (src, type, body). */
export function scriptBlocks(html) {
  const out = []; const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = m[1]; const src = (attrs.match(/\bsrc="([^"]+)"/) || [])[1] || null; const type = (attrs.match(/\btype="([^"]+)"/) || [])[1] || "";
    out.push({ src, type, body: m[2] });
  }
  return out;
}

/**
 * Rewrite ONLY the CDN import lines of the page's firebase module block so the same
 * bindings come from `window.__histFirebase`. Every other byte of the block is kept.
 */
export function rewriteFirebaseModule(body) {
  let imports = 0;
  const rewritten = body.replace(/import\s*\{([^}]*)\}\s*from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/[^"]*\/firebase-([a-z-]+)\.js";/g, (_, names, mod) => {
    imports++;
    const bindings = names.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ": "));
    return `const { ${bindings.join(", ")} } = window.__histFirebase[${JSON.stringify(mod)}];`;
  });
  if (imports === 0) throw new Error("firebase module block: no CDN imports found (page shape changed?)");
  return `(async () => {\n${rewritten}\n})()`;
}

// ── the Firebase modular-API shim over an Admin SDK app (ordinary-member auth override) ──
function firebaseShim({ adminApp, user }) {
  const db = adminApp.database();
  const pathOf = (r) => r.__path;
  const mkRef = (path) => ({ __path: path, __ref: db.ref(path) });
  const listeners = [];
  const auth = { currentUser: null, __listeners: new Set() };
  const notify = () => auth.__listeners.forEach((cb) => { try { cb(auth.currentUser); } catch (_) {} });
  const fakeUser = (u) => ({ uid: u.uid, email: u.email, displayName: u.displayName || null, getIdToken: async () => "historical-page-fake-token" });
  return {
    app: { initializeApp: (cfg, name) => ({ name: name || "[DEFAULT]", options: cfg }) },
    database: {
      getDatabase: () => ({ __admin: true }),
      forceWebSockets: () => {},
      ref: (_db, path) => mkRef(path),
      get: async (r) => r.__ref.once("value"),
      set: async (r, v) => r.__ref.set(v),
      remove: async (r) => r.__ref.remove(),
      onValue: (r, cb, onErr) => { const h = r.__ref.on("value", cb, onErr); listeners.push({ r, h }); return () => r.__ref.off("value", h); },
      runTransaction: async (r, fn, opts) => { const res = await r.__ref.transaction(fn, undefined, opts && opts.applyLocally === false ? false : true); return { committed: res.committed, snapshot: res.snapshot }; },
      __detachAll: () => { while (listeners.length) { const { r, h } = listeners.pop(); try { r.__ref.off("value", h); } catch (_) {} } },
      __pathOf: pathOf,
    },
    auth: {
      getAuth: () => auth,
      onAuthStateChanged: (_a, cb) => { auth.__listeners.add(cb); queueMicrotask(() => cb(auth.currentUser)); return () => auth.__listeners.delete(cb); },
      signInWithEmailAndPassword: async (_a, email) => { auth.currentUser = fakeUser({ ...user, email }); notify(); return { user: auth.currentUser }; },
      createUserWithEmailAndPassword: async () => { throw new Error("not supported in the historical harness"); },
      sendPasswordResetEmail: async () => {}, signOut: async () => { auth.currentUser = null; notify(); },
      updateProfile: async () => {}, updateEmail: async () => {}, updatePassword: async () => {},
      browserLocalPersistence: {}, setPersistence: async () => {},
      __signInSilently: () => { auth.currentUser = fakeUser(user); },
    },
    "app-check": { initializeAppCheck: () => { throw new Error("app-check disabled in harness"); }, ReCaptchaV3Provider: function () {} },
  };
}

/**
 * Boot the historical page. Returns { window, document, console: {errors, warns}, detach, sleep, until }.
 *  - `adminApp`: firebase-admin app with `databaseAuthVariableOverride` for the acting member.
 *  - `user`: { uid, email, displayName }.
 *  - `session`: sessionStorage entries pre-seeded (a retained browser session: `marjin_tid_<uid>`, `marjin_biz_<uid>`).
 *  - `signedIn`: true → the page boots with an existing Firebase Auth session (auto-login path of the page).
 */
export async function bootHistoricalPage({ sha = HISTORICAL_SHA, adminApp, user, session = {}, signedIn = true, fetchImpl = null, log = () => {} } = {}) {
  const st = depsStatus(); if (!st.ok) throw new Error("historical page deps missing: " + st.missing.join(", ") + " — run test/historical/install-deps.sh");
  const req = createRequire(join(DEPS_DIR, "package.json"));
  const { JSDOM } = req("jsdom");
  const Babel = req("@babel/standalone");
  const html = historicalHtml(sha);
  const blocks = scriptBlocks(html);

  const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const errors = [], warns = [];
  w.console = { ...console, error: (...a) => { errors.push(a.map(String).join(" ")); }, warn: (...a) => { warns.push(a.map(String).join(" ")); }, log: () => {}, info: () => {}, debug: () => {} };
  // browser surface the page touches that jsdom does not provide
  Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
  w.confirm = () => true; w.alert = () => {}; w.scrollTo = () => {};
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (!w.navigator.clipboard) Object.defineProperty(w.navigator, "clipboard", { value: { writeText: async () => {} } });
  for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, v);
  w.fetch = fetchImpl || (async (url) => {
    const u = String(url);
    if (u.startsWith("/api/config")) return { ok: true, status: 200, json: async () => ({ apiKey: "demo", authDomain: "demo.local", databaseURL: "http://127.0.0.1:9000?ns=demo-marjin-rules-default-rtdb", projectId: "demo-marjin-rules" }) };
    return { ok: false, status: 404, json: async () => ({ error: "not_available_in_harness" }), text: async () => "" };
  });
  const shim = firebaseShim({ adminApp, user });
  if (signedIn) shim.auth.__signInSilently();
  w.__histFirebase = shim;
  // CDN globals: React/ReactDOM/PropTypes/Babel are the pinned real builds; charts, xlsx and leaflet are inert stand-ins
  const umd = (p) => w.eval(readFileSync(join(DEPS_DIR, "node_modules", p), "utf8"));
  umd("react/umd/react.production.min.js"); umd("react-dom/umd/react-dom.production.min.js"); umd("prop-types/prop-types.min.js");
  w.Recharts = new Proxy({}, { get: (_, name) => { const C = (props) => w.React.createElement("div", { "data-recharts": String(name) }, typeof props.children === "function" ? null : props.children); C.displayName = String(name); return C; } });
  w.XLSX = { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} };
  w.L = { map: () => ({ setView() { return this; }, on() {}, remove() {} }), marker: () => ({ addTo() { return this; }, on() {}, getLatLng: () => ({ lat: 0, lng: 0 }) }), tileLayer: () => ({ addTo() {} }) };

  let firebaseReady = null;
  for (const b of blocks) {
    if (b.src) continue;                                              // CDN tags are provided above
    if (b.type === "module") { firebaseReady = w.eval(rewriteFirebaseModule(b.body)); await firebaseReady; continue; }
    if (b.type === "text/babel") {
      const t0 = Date.now();
      const { code } = Babel.transform(b.body, { presets: ["react"], sourceType: "script", compact: false });
      log(`babel: ${b.body.length} chars → ${code.length} in ${Date.now() - t0}ms`);
      w.eval(code); continue;
    }
    w.eval(b.body);                                                   // plain inline block (apiFetch stub, forecast mirror, …)
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (pred, ms = 8000, step = 25) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timeout: " + (pred.name || pred.toString().slice(0, 80))); await sleep(step); } };
  return { window: w, document: w.document, console: { errors, warns }, sleep, until,
           detach: () => { try { shim.database.__detachAll(); } catch (_) {} try { dom.window.close(); } catch (_) {} } };
}

/** Click helper that goes through React's real event system (bubbling MouseEvent on the node). */
export function click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
export function textOf(el) { return (el && el.textContent || "").replace(/\s+/g, " ").trim(); }
export function findByText(root, selector, text) { return Array.from(root.querySelectorAll(selector)).find((el) => textOf(el) === text) || null; }
