import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const STATUS = { pass: "pass", blocked: "blocked", inconclusive: "inconclusive", skipped: "skipped" };

export class Inconclusive extends Error {}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function fingerprint(secret) {
  return `sha256:${sha256(secret).slice(0, 12)}`;
}

export function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function git(appDir, args, opts = {}) {
  return execFileSync("git", args, { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts });
}

export function gitInfo(appDir) {
  try {
    return {
      commit: git(appDir, ["rev-parse", "--short", "HEAD"]).trim(),
      branch: git(appDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
      subject: git(appDir, ["log", "-1", "--pretty=%s"]).trim(),
    };
  } catch {
    return { commit: null, branch: null, subject: null };
  }
}

// Walk a directory and yield files (relative paths), skipping heavy folders.
export function* walk(root, rel = "") {
  const dir = path.join(root, rel);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".gate") continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) yield* walk(root, r);
    else if (e.isFile()) yield r;
  }
}

// Small timed wrapper that turns any thrown error into an INCONCLUSIVE result.
export async function runCheck(meta, fn) {
  const started = Date.now();
  const base = { id: meta.id, rule: meta.rule, title: meta.title, group: meta.group, evidence: [], debugIds: [] };
  try {
    const out = await fn();
    return { ...base, ...out, ms: Date.now() - started };
  } catch (e) {
    return {
      ...base,
      status: STATUS.inconclusive,
      summary: e instanceof Inconclusive ? e.message : `The check could not finish: ${e?.message ?? e}`,
      ms: Date.now() - started,
    };
  }
}

export function skipped(meta, reason) {
  return { id: meta.id, rule: meta.rule, title: meta.title, group: meta.group, status: STATUS.skipped, summary: reason, evidence: [], debugIds: [], ms: 0 };
}

export async function httpJson(url, { method = "GET", body, headers = {}, timeoutMs = 30_000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, json };
}
