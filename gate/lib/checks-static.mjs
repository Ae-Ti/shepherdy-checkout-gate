import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATUS, fingerprint, git, readJsonFile, runCheck, sha256, walk, writeJsonFile } from "./util.mjs";

const PUBLIC_SECRET = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE)[A-Z0-9_]*/g;
const ENV_FILE = /^\.env(\..+)?$/;
const SOURCE_EXT = /\.(m?[jt]sx?|cjs)$/;

export const META = {
  S1: { id: "S1", rule: "PP-06", group: "Secrets", title: "The PayPal secret is not in what browsers download" },
  S2: { id: "S2", rule: "PP-06", group: "Secrets", title: "No public variable or client component can read the secret" },
  S3: { id: "S3", rule: "PP-07", group: "Secrets", title: "No .env file or secret value is in git, and leaked keys were rotated" },
};

function sourceFiles(ctx) {
  const files = [];
  for (const dir of ctx.config.sourceDirs ?? ["app", "components", "lib"]) {
    for (const rel of walk(path.join(ctx.appDir, dir))) if (SOURCE_EXT.test(rel)) files.push(path.join(dir, rel));
  }
  for (const name of fs.readdirSync(ctx.appDir)) {
    if (/^next\.config\.(m?[jt]s|cjs)$/.test(name)) files.push(name);
  }
  return files;
}

function isClientFile(text) {
  const head = text.replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/, "");
  return /^["']use client["']/.test(head);
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// S1: look for the secret's exact value in the built output that browsers receive.
export function checkBundle(ctx) {
  return runCheck(META.S1, async () => {
    const secret = ctx.env.PAYPAL_CLIENT_SECRET;
    if (!secret) return { status: STATUS.inconclusive, summary: "PAYPAL_CLIENT_SECRET is not set, so there is nothing to look for." };
    const nextDir = path.join(ctx.appDir, ".next");
    const buildId = path.join(nextDir, "BUILD_ID");
    if (!fs.existsSync(buildId)) {
      return { status: STATUS.inconclusive, summary: "No production build found. Run `npm run build` so the gate can read what browsers download." };
    }
    const builtAt = fs.statSync(buildId).mtimeMs;
    const newer = sourceFiles(ctx).find((f) => fs.statSync(path.join(ctx.appDir, f)).mtimeMs > builtAt + 1000);
    if (newer) {
      return { status: STATUS.inconclusive, summary: `The build is older than ${newer}. Rebuild before running the gate.` };
    }
    const targets = [];
    for (const rel of walk(path.join(nextDir, "static"))) targets.push(path.join(".next/static", rel));
    for (const rel of walk(path.join(nextDir, "server", "app"))) {
      if (/\.(html|rsc|body)$/.test(rel)) targets.push(path.join(".next/server/app", rel));
    }
    const needles = [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)];
    const hits = [];
    for (const rel of targets) {
      const buf = fs.readFileSync(path.join(ctx.appDir, rel));
      if (buf.length > 20 * 1024 * 1024) continue;
      const text = buf.toString("utf8");
      if (needles.some((n) => text.includes(n))) hits.push(rel);
    }
    if (hits.length) {
      return {
        status: STATUS.blocked,
        summary: `The PayPal secret (${fingerprint(secret)}) is inside ${hits.length} file(s) that every visitor downloads.`,
        evidence: hits.slice(0, 5).map((f) => ({ label: "Found in", actual: f, ok: false })),
        files: hits,
      };
    }
    return {
      status: STATUS.pass,
      summary: `Scanned ${targets.length} built files. The secret (${fingerprint(secret)}) is not in any of them.`,
      evidence: [{ label: "Files scanned", actual: String(targets.length), ok: true }],
    };
  });
}

// S2: public env names, next.config env blocks, and client components that touch the secret.
export function checkPublicEnv(ctx) {
  return runCheck(META.S2, async () => {
    const findings = [];
    for (const rel of sourceFiles(ctx)) {
      const text = fs.readFileSync(path.join(ctx.appDir, rel), "utf8");
      for (const m of text.matchAll(PUBLIC_SECRET)) {
        findings.push({ file: rel, line: lineOf(text, m.index), why: `${m[0]} would be inlined into the browser bundle` });
      }
      if (/^next\.config\./.test(rel)) {
        const envBlock = text.match(/\benv\s*:\s*\{([\s\S]*?)\}/);
        if (envBlock && /SECRET|PASSWORD|PRIVATE/i.test(envBlock[1])) {
          findings.push({ file: rel, line: lineOf(text, envBlock.index), why: "next.config `env` copies a secret into the browser bundle" });
        }
      }
      if (isClientFile(text)) {
        const m = text.match(/PAYPAL_CLIENT_SECRET|process\.env\.[A-Z0-9_]*SECRET/);
        if (m) findings.push({ file: rel, line: lineOf(text, m.index), why: "a client component reads a secret" });
        const imp = text.match(/from\s+["'](@\/|\.\.?\/)+lib\/(paypal|store|http)["']/);
        if (imp) findings.push({ file: rel, line: lineOf(text, imp.index), why: "a client component imports a server-only module" });
      } else if (/PAYPAL_CLIENT_SECRET/.test(text) && !/^next\.config\./.test(rel)) {
        if (!/import\s+["']server-only["']/.test(text)) {
          findings.push({ file: rel, line: 1, why: 'reads PAYPAL_CLIENT_SECRET without `import "server-only"`' });
        }
      }
    }
    if (findings.length) {
      return {
        status: STATUS.blocked,
        summary: `${findings.length} place(s) could expose the PayPal secret to the browser.`,
        evidence: findings.slice(0, 8).map((f) => ({ label: `${f.file}:${f.line}`, actual: f.why, ok: false })),
        files: [...new Set(findings.map((f) => f.file))],
      };
    }
    return { status: STATUS.pass, summary: "No NEXT_PUBLIC_*SECRET*, no secret in next.config env, no client component touching the secret." };
  });
}

// S3: committed env files, the secret value anywhere in git history, and the rotation lock.
export function checkGit(ctx) {
  return runCheck(META.S3, async () => {
    try {
      git(ctx.appDir, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return { status: STATUS.inconclusive, summary: "This folder is not a git repository." };
    }
    const evidence = [];
    const tracked = git(ctx.appDir, ["ls-files"]).split("\n").filter(Boolean);
    const envFiles = tracked.filter((f) => ENV_FILE.test(path.basename(f)) && path.basename(f) !== ".env.example");
    for (const f of envFiles) evidence.push({ label: "Committed env file", actual: f, ok: false });

    const secret = ctx.env.PAYPAL_CLIENT_SECRET;
    const lockFile = path.join(ctx.outDir, "leaked-secrets.json");
    const lock = readJsonFile(lockFile, { leaked: [] });
    let inHistory = false;
    if (secret) {
      const revs = git(ctx.appDir, ["rev-list", "--all"]).split("\n").filter(Boolean);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
      const patterns = path.join(tmp, "patterns");
      fs.writeFileSync(patterns, secret + "\n", { mode: 0o600 });
      try {
        for (let i = 0; i < revs.length && !inHistory; i += 50) {
          try {
            const out = git(ctx.appDir, ["grep", "-I", "-F", "-l", "-f", patterns, ...revs.slice(i, i + 50), "--"]);
            if (out.trim()) inHistory = true;
          } catch (e) {
            if (e.status !== 1) throw e; // 1 = no match
          }
        }
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const fp = sha256(secret);
      if (inHistory) {
        evidence.push({ label: "Secret value in git history", actual: fingerprint(secret), ok: false });
        if (!lock.leaked.includes(fp)) {
          lock.leaked.push(fp);
          writeJsonFile(lockFile, lock);
        }
      } else if (lock.leaked.includes(fp)) {
        evidence.push({
          label: "Rotation lock",
          actual: `${fingerprint(secret)} leaked earlier. Create a new secret in the PayPal Developer Dashboard; deleting it from code is not enough.`,
          ok: false,
        });
      }
    }
    if (evidence.length) {
      return { status: STATUS.blocked, summary: "Secrets are, or were, committed to git.", evidence };
    }
    return {
      status: STATUS.pass,
      summary: secret
        ? `No env files tracked; ${fingerprint(secret)} is not in any commit and has never leaked.`
        : "No env files tracked.",
    };
  });
}

export async function staticChecks(ctx) {
  return [await checkBundle(ctx), await checkPublicEnv(ctx), await checkGit(ctx)];
}
