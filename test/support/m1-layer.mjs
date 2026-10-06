// M1 integration: which tree is under test, and where each LAYER guard reads its subject.
// On the integrated tree (both approved inputs are ancestors of HEAD) the layer guards of each input verify their
// layer at that input's EXACT commit, from git objects — the Core/F1 R4 layer at M1_CORE_COMMIT, the P1 layer at
// M1_P1_COMMIT — exactly as each standalone candidate was reviewed; the committed, staged and checked-out bytes of the
// integrated tree are held to the M1 identity pins and recorded derivations (test/finance/m1-integration-guard.test.mjs
// and the M1 layer of B2G-05). On a standalone (non-integrated) tree every guard reads HEAD / the working tree, as before.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { M1_CORE_COMMIT, M1_P1_COMMIT } from "./m1-integration-pin.mjs";

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
export function isM1Tree(repo) {
  return git(repo, ["merge-base", "--is-ancestor", M1_CORE_COMMIT, "HEAD"]).status === 0 &&
    git(repo, ["merge-base", "--is-ancestor", M1_P1_COMMIT, "HEAD"]).status === 0;
}
/** A layer subject: `ref` names the commit whose objects are the layer's candidate; `read(path)` returns its bytes. */
export function layerSubject(repo, layerCommit) {
  if (!isM1Tree(repo)) return { m1: false, ref: "HEAD", read: (f) => readFileSync(join(repo, f)), staged: true };
  return { m1: true, ref: layerCommit, read: (f) => { const r = git(repo, ["cat-file", "blob", `${layerCommit}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${layerCommit}:${f}`); return r.stdout; }, staged: false };
}
export const coreLayer = (repo) => layerSubject(repo, M1_CORE_COMMIT);
export const p1Layer = (repo) => layerSubject(repo, M1_P1_COMMIT);
