import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Hash every file under the protected paths. The fix agent must leave all of them untouched.
function listFiles(root, rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [rel];
  const out = [];
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".DS_Store") continue;
    out.push(...listFiles(root, path.join(rel, e.name)));
  }
  return out;
}

export function snapshot(root, paths) {
  const snap = new Map();
  for (const p of paths) {
    for (const f of listFiles(root, p)) {
      snap.set(f, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, f))).digest("hex"));
    }
  }
  return snap;
}

export function compare(root, before, paths) {
  const after = snapshot(root, paths);
  const changed = [];
  const removed = [];
  const added = [];
  for (const [f, h] of before) {
    if (!after.has(f)) removed.push(f);
    else if (after.get(f) !== h) changed.push(f);
  }
  for (const f of after.keys()) if (!before.has(f)) added.push(f);
  return { changed, removed, added, touched: [...changed, ...removed, ...added] };
}

export function copyPaths(from, to, paths) {
  for (const p of paths) {
    for (const f of listFiles(from, p)) {
      fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
      fs.copyFileSync(path.join(from, f), path.join(to, f));
    }
  }
}

// Put protected files back exactly as they were.
export function restore(pristineDir, root, paths, diff) {
  for (const f of diff.added) fs.rmSync(path.join(root, f), { force: true });
  copyPaths(pristineDir, root, paths);
}
