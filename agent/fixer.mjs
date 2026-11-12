import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { AGENT_INSTRUCTIONS } from "./lib/brief.mjs";
import { compare, copyPaths, snapshot } from "./lib/integrity.mjs";

// Files the agent may change. Everything else (gate, playbook, env files, git) is out of reach.
export const EDITABLE = ["app", "components", "lib", "next.config.ts"];
const CONTEXT_ONLY = ["package.json", "tsconfig.json"];

// The AI gets a clean environment: no PayPal secret, no buyer password, no database URL.
function agentEnv(env) {
  const keep = ["PATH", "HOME", "USER", "TMPDIR", "LANG", "SHELL", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "AWS_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"];
  const out = { CLAUDE_AGENT_SDK_CLIENT_APP: "shepherdy-checkout-gate/0.1.0" };
  for (const k of keep) if (env[k] ?? process.env[k]) out[k] = env[k] ?? process.env[k];
  return out;
}

// A throwaway copy with only the editable source. No .env files, no gate, no git: secrets cannot leak to the AI.
function makeWorkCopy(appDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shepherdy-fix-"));
  copyPaths(appDir, dir, [...EDITABLE, ...CONTEXT_ONLY]);
  return dir;
}

function copyBack(workDir, appDir) {
  const before = snapshot(appDir, EDITABLE);
  const inCopy = snapshot(workDir, EDITABLE);
  const changed = [];
  for (const [f, h] of inCopy) {
    if (before.get(f) !== h && !/(^|\/)\.env(\.|$)/.test(f)) {
      fs.mkdirSync(path.dirname(path.join(appDir, f)), { recursive: true });
      fs.copyFileSync(path.join(workDir, f), path.join(appDir, f));
      changed.push(f);
    }
  }
  for (const f of before.keys()) {
    if (!inCopy.has(f)) {
      fs.rmSync(path.join(appDir, f), { force: true });
      changed.push(f);
    }
  }
  return changed;
}

// fake: put back the last READY version of every editable file changed since then (no AI, offline, deterministic).
function fakeFix(appDir, outDir) {
  const lastReady = JSON.parse(fs.readFileSync(path.join(outDir, "last-ready.json"), "utf8")).commit;
  const files = execFileSync("git", ["diff", "--name-only", lastReady, "HEAD", "--", ...EDITABLE], { cwd: appDir, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  for (const f of files) {
    try {
      execFileSync("git", ["cat-file", "-e", `${lastReady}:${f}`], { cwd: appDir, stdio: "ignore" });
      fs.writeFileSync(path.join(appDir, f), execFileSync("git", ["show", `${lastReady}:${f}`], { cwd: appDir }));
    } catch {
      fs.rmSync(path.join(appDir, f), { force: true });
    }
  }
  return { agent: "fake (restore last READY)", summary: `Restored ${files.length} file(s) from the last READY commit ${lastReady.slice(0, 7)}.`, changedFiles: files };
}

async function liveFix(appDir, brief, env, log) {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const workDir = makeWorkCopy(appDir);
  const model = env.SHEPHERDY_MODEL || "claude-sonnet-5-5";
  const tools = ["Read", "Glob", "Grep", "Edit", "Write"];
  let summary = "";
  try {
    const q = query({
      prompt: `${AGENT_INSTRUCTIONS}\n\n${brief.text}`,
      options: {
        cwd: workDir,
        model,
        tools,
        allowedTools: tools,
        disallowedTools: ["Bash", "WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit"],
        permissionMode: "acceptEdits",
        permissionPrompts: "none",
        settingSources: [],
        maxTurns: 40,
        env: agentEnv(env),
      },
    });
    for await (const m of q) {
      if (m.type === "assistant") {
        for (const block of m.message?.content ?? []) {
          if (block.type === "tool_use") log(`  agent → ${block.name} ${block.input?.file_path ?? block.input?.pattern ?? ""}`);
        }
      }
      if (m.type === "result") summary = m.subtype === "success" ? String(m.result ?? "") : `Agent stopped: ${m.subtype}`;
    }
    const changedFiles = copyBack(workDir, appDir);
    return { agent: `Claude Agent SDK (${model})`, summary, changedFiles };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function commandFix(appDir, brief, env) {
  const workDir = makeWorkCopy(appDir);
  const briefFile = path.join(workDir, "FIX_BRIEF.md");
  fs.writeFileSync(briefFile, `${AGENT_INSTRUCTIONS}\n\n${brief.text}\n`);
  try {
    const res = spawnSync(env.AGENT_CMD, { cwd: workDir, shell: true, stdio: "inherit", env: { ...agentEnv(env), FIX_BRIEF: briefFile } });
    fs.rmSync(briefFile, { force: true });
    const changedFiles = copyBack(workDir, appDir);
    return { agent: `AGENT_CMD (exit ${res.status})`, summary: "", changedFiles };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runFixer({ appDir, outDir, brief, env, log = console.log }) {
  if (env.AGENT_CMD) return commandFix(appDir, brief, env);
  if (env.LLM_MODE === "fake") return fakeFix(appDir, outDir);
  if (!env.ANTHROPIC_API_KEY && !env.CLAUDE_CODE_USE_BEDROCK) {
    throw new Error("Set ANTHROPIC_API_KEY (or CLAUDE_CODE_USE_BEDROCK=1) for the live fix agent, or LLM_MODE=fake to restore the last READY files.");
  }
  return liveFix(appDir, brief, env, log);
}
