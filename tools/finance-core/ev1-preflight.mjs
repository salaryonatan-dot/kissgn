// EV-1 collector — ENVIRONMENT / IDENTITY PREFLIGHT (pure checks + local filesystem stat).
//
// Runs BEFORE any network activity. Every refusal throws Ev1PreflightError with a stable code;
// nothing here reads the database, and the credential file is parsed only to verify its shape
// and project binding (its content never leaves this module except a sha256 prefix of the
// client email and the key material handed to the transport's token signer).
//
// Expected Production identity (from the approved Gate 0 / Codex EV-1 run contract,
// 2026-09-29 06_OPERATOR_RUN_CONTRACT.md): project `kissgn-1227b`, database
// `https://kissgn-1227b-default-rtdb.firebaseio.com`. The operator must pass both explicitly;
// they must equal these constants exactly.
import { lstatSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";

export const EXPECTED_PRODUCTION = Object.freeze({
  project: "kissgn-1227b",
  databaseUrl: "https://kissgn-1227b-default-rtdb.firebaseio.com",
  tokenUri: "https://oauth2.googleapis.com/token",
});

/** Environment variables that could inject an alternate credential, an implicit ADC or an emulator. */
export const FORBIDDEN_ENV = Object.freeze([
  "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_OAUTH_ACCESS_TOKEN", "CLOUDSDK_AUTH_ACCESS_TOKEN", "CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE",
  "FIREBASE_TOKEN", "FIREBASE_SA_JSON", "FIREBASE_SA_PRIVATE_KEY", "FIREBASE_SA_CLIENT_EMAIL", "FIREBASE_CONFIG",
  "FIREBASE_DATABASE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_EMULATOR_HUB",
  "GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT",
]);

const PLACEHOLDER = /^(|<.*>|your[-_].*|example.*|changeme|placeholder|todo|xxx+|fixture.*|test.*|demo.*|my[-_]project)$/i;

export class Ev1PreflightError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "Ev1PreflightError";
    this.code = code;
    this.detail = detail;
  }
}
const refuse = (code, detail) => { throw new Ev1PreflightError(code, detail); };

const DATE_SHAPE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function isRealDate(v) {
  const m = typeof v === "string" ? DATE_SHAPE.exec(v) : null;
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dim = mo === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(mo) ? 30 : 31;
  return d <= dim;
}
/** Current Israel business date (Asia/Jerusalem) for an epoch-ms instant. */
export function israelDate(nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Nearest existing ancestor directory of `p` (the path itself when it exists). */
function nearestExisting(p) {
  let c = p;
  while (!existsSync(c)) { const up = dirname(c); if (up === c) break; c = up; }
  return c;
}
/** True when `p` or any ancestor contains a `.git` entry (work tree or worktree link). Pure fs. */
export function insideGitTree(p) {
  let c = nearestExisting(resolve(p));
  for (;;) {
    if (existsSync(join(c, ".git"))) return true;
    const up = dirname(c);
    if (up === c) return false;
    c = up;
  }
}

export function validateEnv(processEnv) {
  const present = FORBIDDEN_ENV.filter((k) => typeof processEnv[k] === "string" && processEnv[k] !== "");
  if (present.length) refuse("forbidden_environment", present.join(","));
}

export function validateDatabaseUrl(databaseUrl, project) {
  if (typeof databaseUrl !== "string" || databaseUrl === "") refuse("database_url_required");
  let u;
  try { u = new URL(databaseUrl); } catch { refuse("database_url_invalid", "unparseable"); }
  if (u.protocol !== "https:") refuse("database_url_invalid", "https required");
  if (u.port !== "" || u.search !== "" || u.hash !== "" || u.username !== "" || u.password !== "" || (u.pathname !== "/" && u.pathname !== "")) refuse("database_url_invalid", "bare https origin required");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host) || host === "::1" || host === "[::1]" || /^\[/.test(host)) refuse("database_url_local", host);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/.test(host)) refuse("database_url_invalid", "not a Firebase RTDB host");
  if (!host.startsWith(project + "-") && !host.startsWith(project + ".")) refuse("database_project_mismatch", `${host} ∌ ${project}`);
  return `https://${host}`;
}

/**
 * Credential file checks (no network). Returns the parsed service account and a safe identity.
 * Refuses: missing, symlink, non-regular file, group/other-accessible mode, unparseable JSON,
 * wrong shape, project mismatch, unexpected token_uri.
 */
export function loadCredential(credentialsFile, project, { platform = process.platform } = {}) {
  if (typeof credentialsFile !== "string" || credentialsFile === "") refuse("credentials_file_required");
  if (!existsSync(credentialsFile)) refuse("credentials_file_missing");
  const st = lstatSync(credentialsFile);
  if (st.isSymbolicLink()) refuse("credentials_file_symlink");
  if (!st.isFile()) refuse("credentials_file_not_regular");
  if (platform !== "win32" && (st.mode & 0o077) !== 0) refuse("credentials_file_permissions", `mode ${(st.mode & 0o777).toString(8)} (need 0600 or stricter)`);
  let sa;
  try { sa = JSON.parse(readFileSync(credentialsFile, "utf8")); } catch { refuse("credentials_file_unparseable"); }
  if (!sa || typeof sa !== "object" || sa.type !== "service_account") refuse("credentials_file_shape", "not a service_account JSON");
  if (typeof sa.client_email !== "string" || !sa.client_email.includes("@")) refuse("credentials_file_shape", "client_email");
  if (typeof sa.private_key !== "string" || !/-----BEGIN (RSA )?PRIVATE KEY-----/.test(sa.private_key)) refuse("credentials_file_shape", "private_key");
  if (sa.project_id !== project) refuse("credentials_project_mismatch", "service-account project_id differs from --project");
  if (sa.token_uri !== undefined && sa.token_uri !== EXPECTED_PRODUCTION.tokenUri) refuse("credentials_token_uri_unexpected");
  return {
    sa,
    safeIdentity: { type: "service_account", projectId: sa.project_id, clientEmailSha256Prefix: createHash("sha256").update(sa.client_email).digest("hex").slice(0, 16) },
  };
}

export function validateOutDir(outDir) {
  if (typeof outDir !== "string" || outDir === "") refuse("out_dir_required");
  const abs = resolve(outDir);
  if (existsSync(abs)) refuse("out_dir_exists", "a new, non-existent run directory is required");
  const parent = dirname(abs);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) refuse("out_dir_parent_missing");
  if (lstatSync(parent).isSymbolicLink()) refuse("out_dir_parent_symlink");
  if (insideGitTree(parent)) refuse("out_dir_inside_git");
  return abs;
}

/**
 * Full Production preflight. `repo` is `{ headSha, treeClean }` of the checkout running the tool.
 * Every check runs before any network activity; the first failure refuses the run.
 */
export function preflightProduction(flags, { processEnv, repo, nowMs, platform }) {
  if (flags.env !== "production") refuse("env_required", "--env production");
  if (flags.fixture !== undefined) refuse("fixture_in_production");
  validateEnv(processEnv);
  const project = flags.project;
  if (typeof project !== "string" || PLACEHOLDER.test(project)) refuse("project_placeholder_or_missing");
  if (project !== EXPECTED_PRODUCTION.project) refuse("project_mismatch", `${project} ≠ expected Production project`);
  const databaseUrl = validateDatabaseUrl(flags["database-url"], project);
  if (databaseUrl !== EXPECTED_PRODUCTION.databaseUrl) refuse("database_mismatch", `${databaseUrl} ≠ expected Production database`);
  const asOf = flags["as-of"];
  if (!isRealDate(asOf)) refuse("as_of_invalid", "--as-of YYYY-MM-DD (real calendar date) required");
  const today = israelDate(nowMs);
  if (asOf > today) refuse("as_of_in_future", `${asOf} > Israel business date ${today}`);
  const expectedCommit = flags["expected-commit"];
  if (typeof expectedCommit !== "string" || !/^[0-9a-f]{40}$/.test(expectedCommit)) refuse("expected_commit_required", "--expected-commit <40-hex approved sha>");
  if (!repo || repo.headSha !== expectedCommit) refuse("commit_mismatch", `checkout ${repo ? repo.headSha : "unknown"} ≠ approved ${expectedCommit}`);
  if (repo.treeClean !== true) refuse("tree_dirty", "tracked files modified");
  const outDir = validateOutDir(flags["out-dir"]);
  const cred = loadCredential(flags["credentials-file"], project, { platform });
  return { mode: "production", project, databaseUrl, databaseHost: new URL(databaseUrl).host, asOfBusinessDate: asOf, expectedCommit, outDir, credential: cred };
}

/** Offline fixture preflight: never production, never credentials, never network. */
export function preflightFixture(flags, { processEnv, nowMs }) {
  if (flags.env === "production") refuse("fixture_in_production");
  if (flags["credentials-file"] !== undefined || flags["database-url"] !== undefined) refuse("fixture_with_production_inputs");
  validateEnv(processEnv);
  const asOf = flags["as-of"];
  if (!isRealDate(asOf)) refuse("as_of_invalid");
  if (asOf > israelDate(nowMs)) refuse("as_of_in_future");
  const outDir = validateOutDir(flags["out-dir"]);
  return { mode: "fixture", project: "fixture", databaseUrl: null, databaseHost: "fixture", asOfBusinessDate: asOf, expectedCommit: null, outDir, credential: null };
}
