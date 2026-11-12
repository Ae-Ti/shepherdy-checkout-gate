import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { checkBundle, checkGit, checkPublicEnv } from "../gate/lib/checks-static.mjs";

const SECRET = "EFAKE_sandbox_secret_value_1234567890";

function app(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function ctx(dir, secret = SECRET) {
  return { appDir: dir, outDir: path.join(dir, ".gate"), env: { PAYPAL_CLIENT_SECRET: secret }, config: { sourceDirs: ["app", "components", "lib"] } };
}

const SAFE_SERVER = `import "server-only";\nexport const s = process.env.PAYPAL_CLIENT_SECRET;\n`;

test("S2 passes for a server-only module that reads the secret", async () => {
  const r = await checkPublicEnv(ctx(app({ "lib/paypal.ts": SAFE_SERVER, "next.config.ts": "export default {};\n" })));
  assert.equal(r.status, "pass");
});

test("S2 blocks NEXT_PUBLIC secrets, next.config env and client components", async () => {
  const r = await checkPublicEnv(
    ctx(
      app({
        "lib/paypal.ts": SAFE_SERVER,
        "components/Pay.tsx": `"use client";\nconst s = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_SECRET;\n`,
        "next.config.ts": `export default { env: { NEXT_PUBLIC_PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET } };\n`,
      }),
    ),
  );
  assert.equal(r.status, "blocked");
  assert.ok(r.evidence.length >= 3);
});

test("S2 blocks a server module that reads the secret without server-only", async () => {
  const r = await checkPublicEnv(ctx(app({ "lib/pay.ts": "export const s = process.env.PAYPAL_CLIENT_SECRET;\n" })));
  assert.equal(r.status, "blocked");
});

test("S1 is inconclusive without a build, blocks a leaked secret, passes a clean bundle", async () => {
  const dir = app({ "app/page.tsx": "export default function P(){return null}\n" });
  assert.equal((await checkBundle(ctx(dir))).status, "inconclusive");

  fs.mkdirSync(path.join(dir, ".next/static/chunks"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".next/static/chunks/a.js"), `const k="${SECRET}";`);
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(dir, ".next/BUILD_ID"), "x");
  fs.utimesSync(path.join(dir, ".next/BUILD_ID"), later, later);
  const leaked = await checkBundle(ctx(dir));
  assert.equal(leaked.status, "blocked");
  assert.ok(!JSON.stringify(leaked).includes(SECRET), "the report must not contain the secret");

  fs.writeFileSync(path.join(dir, ".next/static/chunks/a.js"), "const k=1;");
  assert.equal((await checkBundle(ctx(dir))).status, "pass");
});

function gitRepo(files) {
  const dir = app(files);
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q");
  g("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
  return { dir, g };
}

test("S3 blocks a committed .env.local", async () => {
  const { dir } = gitRepo({ ".env.local": "PAYPAL_CLIENT_SECRET=x\n", "app/a.ts": "export {}\n" });
  const r = await checkGit(ctx(dir, "something-else-123"));
  assert.equal(r.status, "blocked");
});

test("S3 rotation lock: a leaked value keeps blocking until the secret changes", async () => {
  const { dir, g } = gitRepo({ "lib/key.ts": `export const k = "${SECRET}";\n` });
  const first = await checkGit(ctx(dir));
  assert.equal(first.status, "blocked");

  // Rewrite history so the value is gone from git, but keep the same secret.
  fs.writeFileSync(path.join(dir, "lib/key.ts"), "export const k = process.env.X;\n");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-am", "clean");
  fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
  g("init", "-q");
  g("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  g("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fresh");

  const sameSecret = await checkGit(ctx(dir));
  assert.equal(sameSecret.status, "blocked", "still blocked: the leaked secret was not rotated");
  assert.match(JSON.stringify(sameSecret.evidence), /Rotation lock/);

  const rotated = await checkGit(ctx(dir, "a-brand-new-rotated-secret-987"));
  assert.equal(rotated.status, "pass");
});
