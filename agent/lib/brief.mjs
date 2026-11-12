// Turns a gate report into the fix brief for the agent. Built only from the masked report, so it holds no secrets.
export function buildBrief(report, rules) {
  const failed = report.checks.filter((c) => c.status === "blocked");
  const ruleIds = [...new Set(failed.map((c) => c.rule))];
  const lines = [];
  lines.push("FAILED CHECKS (from the gate; secrets are hidden)");
  for (const c of failed) {
    lines.push(`\n- [${c.id} / ${c.rule}] ${c.title}`);
    lines.push(`  ${c.summary}`);
    for (const e of c.evidence ?? []) {
      lines.push(`  · ${e.label}: ${e.actual}${e.expected !== undefined ? ` (expected ${e.expected})` : ""}`);
    }
    if (c.files?.length) lines.push(`  · files: ${c.files.slice(0, 8).join(", ")}`);
  }
  lines.push("\nPLAYBOOK RULES YOU BROKE");
  for (const id of ruleIds) lines.push(`- ${id}: ${rules[id] ?? "(see playbook/paypal-checkout.md)"}`);
  lines.push("\nALL PLAYBOOK RULES");
  for (const [id, text] of Object.entries(rules)) lines.push(`- ${id}: ${text}`);
  return { text: lines.join("\n"), ruleIds, failedIds: failed.map((c) => c.id) };
}

export const AGENT_INSTRUCTIONS = `You are the fix agent of Shepherdy Checkout Gate. A Next.js booking site with a PayPal checkout failed the release gate.
Change the code so the failed checks pass.
- Work only on files in this folder. You cannot run commands.
- Follow the playbook rules exactly. Do not weaken checks, add test-only shortcuts or hard-code results; the gate attacks the app again and asks PayPal for its records.
- Never add secrets, .env files or API keys. PAYPAL_CLIENT_SECRET may only be read in server modules that import "server-only".
- Keep these routes and markers, the gate uses them: /api/bookings, /api/paypal/create-order, /api/paypal/capture-order, /api/paypal/booking-status, /api/health, data-testid="paypal-payment-success" with data-order-id.
- Change as little as needed.
When you finish, answer in 2-4 plain sentences: what you changed and which rule ID each change satisfies.`;
