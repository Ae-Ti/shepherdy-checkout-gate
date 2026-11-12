import { STATUS, httpJson, runCheck, skipped } from "./util.mjs";
import { createPayPal } from "./paypal.mjs";

export const META = {
  D1: { id: "D1", rule: "PP-08", group: "Setup", title: "PayPal sandbox credentials are set" },
  D2: { id: "D2", rule: "PP-08", group: "Setup", title: "Everything points at the PayPal sandbox, never live" },
  D3: { id: "D3", rule: "PP-08", group: "Setup", title: "PayPal sandbox is answering" },
  D4: { id: "D4", rule: "PP-08", group: "Setup", title: "The app is running and can store bookings" },
};

// Doctor checks tell "your setup or PayPal is down" apart from "your code is wrong".
// Setup problems give INCONCLUSIVE, never a false READY or a false BLOCKED.
export async function doctor(ctx) {
  const out = { checks: [], paypalOk: false, appOk: false, health: null };
  const env = ctx.env;

  out.checks.push(
    await runCheck(META.D1, async () => {
      const missing = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"].filter((k) => !env[k]);
      if (missing.length) return { status: STATUS.inconclusive, summary: `Missing ${missing.join(", ")} in .env.local.` };
      return { status: STATUS.pass, summary: "Client ID and secret are present (values hidden)." };
    }),
  );

  const paypal = createPayPal(env);
  out.checks.push(
    await runCheck(META.D2, async () => {
      if (!paypal.isSandbox) {
        return { status: STATUS.blocked, summary: `PAYPAL_API_BASE points at ${paypal.base}. The gate and the fix agent only run against the sandbox.` };
      }
      return { status: STATUS.pass, summary: "PAYPAL_API_BASE is the sandbox." };
    }),
  );

  if (ctx.staticOnly) {
    out.checks.push(skipped(META.D3, "Static-only run."), skipped(META.D4, "Static-only run."));
    return out;
  }

  out.checks.push(
    await runCheck(META.D3, async () => {
      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return { status: STATUS.inconclusive, summary: "Skipped: credentials missing." };
      if (!paypal.isSandbox) return { status: STATUS.inconclusive, summary: "Skipped: not the sandbox." };
      try {
        await paypal.auth();
      } catch (e) {
        const hint =
          e.status === 401
            ? "PayPal rejected the credentials. Check they are SANDBOX app credentials."
            : "PayPal sandbox did not answer properly. This is not your code; try again in a few minutes.";
        return { status: STATUS.inconclusive, summary: hint, debugIds: e.debugId ? [e.debugId] : [] };
      }
      out.paypalOk = true;
      return { status: STATUS.pass, summary: "Got a sandbox access token.", debugIds: [...paypal.debugIds] };
    }),
  );

  out.checks.push(
    await runCheck(META.D4, async () => {
      let res;
      try {
        res = await httpJson(`${ctx.baseUrl}/api/health`, { timeoutMs: 10_000 });
      } catch {
        return { status: STATUS.inconclusive, summary: `The app is not reachable at ${ctx.baseUrl}. Start it with \`npm run start\`.` };
      }
      out.health = res.json;
      if (!res.ok || !res.json.ok) return { status: STATUS.inconclusive, summary: "The app is up but cannot store bookings (check DATABASE_URL)." };
      if (res.json.sandbox !== true) return { status: STATUS.blocked, summary: "The app itself is configured for live PayPal." };
      out.appOk = true;
      return {
        status: STATUS.pass,
        summary: `App is up (store: ${res.json.store}, PayPal host: ${res.json.paypalHost}).`,
      };
    }),
  );
  return out;
}
