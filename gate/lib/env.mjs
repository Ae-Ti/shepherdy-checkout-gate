import fs from "node:fs";
import path from "node:path";

// Reads the app's .env and .env.local the way Next.js does (process env wins). Values are never printed.
export function loadAppEnv(appDir) {
  const fromFiles = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(appDir, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      fromFiles[m[1]] = v;
    }
  }
  const env = { ...fromFiles };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== "") env[k] = v;
  return env;
}

// Every value that must never appear in a report, a log or an AI request.
export const SECRET_KEYS = [
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_SANDBOX_BUYER_PASSWORD",
  "GATE_MOCK_TOKEN",
  "ANTHROPIC_API_KEY",
  "DATABASE_URL",
];

export function secretValues(env) {
  return SECRET_KEYS.map((k) => env[k]).filter((v) => typeof v === "string" && v.length >= 6);
}

export function maskDeep(value, secrets) {
  if (!secrets.length) return value;
  if (typeof value === "string") {
    let out = value;
    for (const s of secrets) out = out.split(s).join("[hidden]");
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, secrets)]));
  }
  return value;
}
