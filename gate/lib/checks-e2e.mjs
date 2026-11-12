import fs from "node:fs";
import { Inconclusive, STATUS, skipped } from "./util.mjs";
import { orderFacts, sameAmount } from "./paypal.mjs";
import { bookingStatus, capture, createBooking } from "./checks-http.mjs";
import { routePath, routeUrl } from "./routes.mjs";

export const META = {
  E1: { id: "E1", rule: "PP-04", group: "End to end", title: "A sandbox buyer pays and PayPal's record says COMPLETED" },
  A4: { id: "A4", rule: "PP-02", group: "Attacks", title: "An approved order cannot be attached to another booking" },
  A6: { id: "A6", rule: "PP-05", group: "Attacks", title: "A declined payment leaves the booking unpaid so the buyer can retry" },
  A5: { id: "A5", rule: "PP-03", group: "Attacks", title: "Retrying the capture never charges twice" },
};

const PAY_BUTTONS = [
  "#payment-submit-btn",
  "[data-testid='submit-button-initial']",
  "button:has-text('Complete Purchase')",
  "button:has-text('Pay Now')",
  "button:has-text('Continue to Review')",
].join(", ");

async function autoApprove(popup, env) {
  const email = env.PAYPAL_SANDBOX_BUYER_EMAIL;
  const password = env.PAYPAL_SANDBOX_BUYER_PASSWORD;
  if (!email || !password) {
    throw new Inconclusive("Set PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD, or run with --manual and approve in the window.");
  }
  try {
    await popup.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    await popup.locator("#email, input[name='login_email']").first().fill(email, { timeout: 45_000 });
    const next = popup.locator("#btnNext").first();
    if (await next.isVisible().catch(() => false)) await next.click();
    await popup.locator("#password, input[name='login_password']").first().fill(password, { timeout: 45_000 });
    await popup.locator("#btnLogin").first().click();
    await popup.locator(PAY_BUTTONS).first().click({ timeout: 90_000 });
  } catch {
    throw new Inconclusive("Automatic sandbox login was blocked by the PayPal page. Run `npm run gate -- --manual` and approve in the window.");
  }
}

function result(meta, status, summary, evidence = [], debugIds = []) {
  return { id: meta.id, rule: meta.rule, title: meta.title, group: meta.group, status, summary, evidence, debugIds, ms: 0 };
}

// One real sandbox payment. While it happens, the gate intercepts the page's capture request and first
// tries two attacks with the same approved order (A4 and A6). After it, it retries the capture (A5).
export async function e2eChecks(ctx, paypal, log = console.log) {
  let pw;
  try {
    pw = await import("@playwright/test");
  } catch {
    const why = "Playwright is not installed. Run `npm install` and `npx playwright install chromium`.";
    return Object.values(META).map((m) => skipped(m, why));
  }
  const started = Date.now();
  const mockToken = ctx.env.GATE_MOCK_TOKEN;
  const waitMs = (ctx.manual ? ctx.config.manualApprovalTimeoutSec ?? 300 : 150) * 1000;
  const seen = { intercepted: null, a4: null, a4Status: null, a6: null, a6Status: null, error: null };
  let orderId = null;
  let outcome = null; // "success" | "error" | "pending"
  let flowError = null;
  let bookingA;
  let bookingB;

  const consoleErrors = [];
  let page = null;
  let popupPage = null;
  let popupShot = false;
  try {
    bookingA = await createBooking(ctx, "E1");
    bookingB = await createBooking(ctx, "A4");
    const browser = await pw.chromium.launch({ headless: !ctx.manual });
    try {
      // English PayPal pages, so the run reads the same for every viewer.
      const context = await browser.newContext({ locale: "en-US" });
      page = await context.newPage();
      context.on("page", (p) => {
        if (p !== page) popupPage = p;
      });
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240));
      });
      page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e).slice(0, 240)));
      let createOrderSeen = false;
      page.on("request", (r) => {
        if (r.url().includes(routePath(ctx, "createOrder"))) createOrderSeen = true;
      });
      await page.route(`**${routePath(ctx, "captureOrder")}`, async (route) => {
        if (seen.intercepted) return route.continue();
        try {
          seen.intercepted = JSON.parse(route.request().postData() || "{}");
          seen.a4 = await capture(ctx, { orderId: seen.intercepted.orderId, bookingId: bookingB });
          seen.a4Status = await bookingStatus(ctx, bookingB);
          if (mockToken) {
            seen.a6 = await capture(ctx, seen.intercepted, { "x-gate-mock": "INSTRUMENT_DECLINED", "x-gate-mock-token": mockToken });
            seen.a6Status = await bookingStatus(ctx, seen.intercepted.bookingId);
          }
        } catch (e) {
          seen.error = e;
        }
        await route.continue();
      });
      await page.goto(routeUrl(ctx, "bookPage", { bookingId: bookingA }), { waitUntil: "domcontentloaded" });
      // The button is drawn before the SDK is ready (disabled while loading). Wait until it is really clickable.
      const ready = await page
        .waitForFunction(
          () => {
            if (document.querySelector("[data-testid='paypal-sdk-error']")) return "sdk-error";
            const b = document.querySelector("paypal-button");
            if (!b) return false;
            const disabled = b.hasAttribute("disabled") || b.disabled === true;
            return disabled ? false : "ready";
          },
          null,
          { timeout: 90_000 },
        )
        .then((h) => h.jsonValue())
        .catch(() => "timeout");
      if (ready !== "ready") {
        const why =
          ready === "sdk-error"
            ? await page.locator("[data-testid='paypal-sdk-error']").innerText()
            : "The PayPal button stayed disabled for 90s: the PayPal JS SDK did not finish loading.";
        throw new Inconclusive(`${why}${consoleErrors.length ? ` Browser console: ${consoleErrors.slice(0, 2).join(" | ")}` : ""}`);
      }
      const button = page.locator("paypal-button").first();
      const popupPromise = context.waitForEvent("page", { timeout: 60_000 }).catch(() => null);
      for (let attempt = 1; attempt <= 3 && !createOrderSeen; attempt++) {
        await button.click();
        for (let i = 0; i < 16 && !createOrderSeen; i++) await page.waitForTimeout(500);
      }
      if (!createOrderSeen) {
        throw new Inconclusive(
          `Clicking the PayPal button did not start a payment (no create-order request).${consoleErrors.length ? ` Browser console: ${consoleErrors.slice(0, 2).join(" | ")}` : ""}`,
        );
      }
      if (ctx.manual) {
        const popup = await popupPromise;
        if (popup) await popup.bringToFront().catch(() => {});
        log(
          `  → ${popup ? "A PayPal window is open (brought to the front)." : "Approve the payment in the PayPal dialog on the page."} Log in with the sandbox BUYER (personal) account and approve (waiting up to ${Math.round(waitMs / 1000)}s)…`,
        );
      } else {
        const popup = await popupPromise;
        if (!popup) throw new Inconclusive("The PayPal window did not open. Run the gate with --manual.");
        await autoApprove(popup, ctx.env);
      }
      const done = page.locator("[data-testid='paypal-payment-success'], [data-testid='paypal-payment-error'], [data-testid='paypal-payment-pending']").first();
      await done.waitFor({ state: "visible", timeout: waitMs });
      const testId = await done.getAttribute("data-testid");
      outcome = testId === "paypal-payment-success" ? "success" : testId === "paypal-payment-pending" ? "pending" : "error";
      orderId = seen.intercepted?.orderId ?? (await done.getAttribute("data-order-id"));
      if (outcome === "error") consoleErrors.unshift(`page said: ${(await done.innerText()).slice(0, 200)}`);
    } catch (e) {
      // Keep a picture of what the buyer saw, for the report and for debugging.
      if (page) {
        fs.mkdirSync(ctx.outDir, { recursive: true });
        await page.screenshot({ path: `${ctx.outDir}/e1-failure.png`, fullPage: true }).catch(() => {});
      }
      // And of the PayPal window itself, if it is still open (login page, error, review page).
      if (popupPage && !popupPage.isClosed()) {
        fs.mkdirSync(ctx.outDir, { recursive: true });
        popupShot = await popupPage
          .screenshot({ path: `${ctx.outDir}/e1-popup.png` })
          .then(() => true)
          .catch(() => false);
      }
      throw e;
    } finally {
      await browser.close();
    }
  } catch (e) {
    flowError = e;
  }

  const ms = Date.now() - started;
  const out = [];

  // E1
  if (flowError || !orderId) {
    const why =
      flowError instanceof Inconclusive
        ? flowError.message
        : flowError?.name === "TimeoutError"
          ? `Nobody approved the payment in the PayPal window in time.${ctx.manual ? "" : " Try --manual."}`
          : `The sandbox payment did not finish (${flowError?.message ?? "no order"}).`;
    const evidence = consoleErrors.slice(0, 3).map((t) => ({ label: "Browser console", actual: t }));
    if (flowError) evidence.push({ label: "Screenshot", actual: ".gate/e1-failure.png" });
    if (popupShot) evidence.push({ label: "PayPal window", actual: ".gate/e1-popup.png" });
    out.push(result(META.E1, STATUS.inconclusive, why, evidence));
  } else {
    const facts = orderFacts(await paypal.getOrder(orderId));
    const status = await bookingStatus(ctx, bookingA);
    const evidence = [
      { label: "PayPal order status", expected: "COMPLETED", actual: String(facts.status), ok: facts.status === "COMPLETED" },
      { label: "PayPal capture status", expected: "COMPLETED", actual: String(facts.captureStatus), ok: facts.captureStatus === "COMPLETED" },
      { label: "PayPal captured amount", expected: `${ctx.config.expectedAmount} ${ctx.config.currency}`, actual: `${facts.captureAmount} ${facts.currency}`, ok: sameAmount(facts.captureAmount, ctx.config.expectedAmount) },
      { label: "PayPal reference_id", expected: bookingA, actual: String(facts.referenceId), ok: facts.referenceId === bookingA },
      { label: "Booking status in the app", expected: "paid", actual: status, ok: status === "paid" },
      { label: "PayPal order", actual: orderId },
    ];
    const ok = evidence.every((e) => e.ok !== false);
    let summary = "PayPal recorded a COMPLETED capture at the server price, and only then the booking became paid.";
    if (!ok) {
      if (status === "paid" && facts.captureStatus !== "COMPLETED") summary = "The app confirmed a booking that PayPal did not complete.";
      else if (facts.captureStatus === "COMPLETED" && status !== "paid") summary = "PayPal completed the payment but the app did not confirm the booking.";
      else if (outcome === "pending") summary = "PayPal left the capture PENDING; the booking correctly stayed unconfirmed. Run again later.";
      else summary = "The sandbox payment did not end in a matching COMPLETED record.";
    }
    const status1 = ok ? STATUS.pass : outcome === "pending" ? STATUS.inconclusive : STATUS.blocked;
    out.push({ ...result(META.E1, status1, summary, evidence, paypal.debugIds.slice(-1)), ms });
  }

  // A4
  if (!seen.intercepted || !seen.a4) {
    out.push(result(META.A4, STATUS.inconclusive, seen.error ? `Interception failed: ${seen.error.message}` : "The page never asked the server to capture a payment."));
  } else {
    const evidence = [
      { label: "Approved order reused for", actual: bookingB },
      { label: "App answer", expected: "refused", actual: `HTTP ${seen.a4.status} ${seen.a4.json.error ?? seen.a4.json.status ?? ""}`.trim(), ok: !seen.a4.ok },
      { label: "Other booking status", expected: "not paid", actual: String(seen.a4Status), ok: seen.a4Status !== "paid" },
    ];
    const ok = evidence.every((e) => e.ok !== false);
    out.push(result(META.A4, ok ? STATUS.pass : STATUS.blocked, ok ? "Attaching an approved order to a different booking was refused." : "One buyer's approved order confirmed a different booking.", evidence));
  }

  // A6
  if (!mockToken) {
    out.push(result(META.A6, STATUS.inconclusive, "Set GATE_MOCK_TOKEN in .env.local (the app and the gate read the same file) so the gate can simulate a declined payment."));
  } else if (!seen.a6) {
    out.push(result(META.A6, STATUS.inconclusive, "The simulated decline could not be sent."));
  } else {
    const declined = seen.a6.status === 402 && seen.a6.json.error === "INSTRUMENT_DECLINED";
    const evidence = [
      { label: "PayPal-Mock-Response", actual: "INSTRUMENT_DECLINED (sandbox negative testing)" },
      { label: "App answer", expected: "HTTP 402 INSTRUMENT_DECLINED, retry allowed", actual: `HTTP ${seen.a6.status} ${seen.a6.json.error ?? seen.a6.json.status ?? ""}`.trim(), ok: declined },
      { label: "Booking status right after", expected: "not paid", actual: String(seen.a6Status), ok: seen.a6Status !== "paid" },
    ];
    const ok = evidence.every((e) => e.ok !== false);
    out.push(result(META.A6, ok ? STATUS.pass : STATUS.blocked, ok ? "The declined payment kept the booking unpaid and told the buyer to retry." : "The app did not handle PayPal's decline correctly.", evidence));
  }

  // A5
  if (!orderId || out[0].status !== STATUS.pass) {
    out.push(result(META.A5, STATUS.inconclusive, "Needs a completed payment from E1."));
  } else {
    const res = await capture(ctx, { orderId, bookingId: bookingA });
    const facts = orderFacts(await paypal.getOrder(orderId));
    const status = await bookingStatus(ctx, bookingA);
    const evidence = [
      { label: "Second capture request", expected: "same result, no new charge", actual: `HTTP ${res.status} ${res.json.status ?? res.json.error ?? ""}`.trim(), ok: res.ok && res.json.status === "paid" },
      { label: "Captures recorded by PayPal", expected: "1", actual: String(facts.captureCount), ok: facts.captureCount === 1 },
      { label: "Booking status", expected: "paid", actual: status, ok: status === "paid" },
    ];
    const ok = evidence.every((e) => e.ok !== false);
    out.push(result(META.A5, ok ? STATUS.pass : STATUS.blocked, ok ? "Retrying returned the same paid result and PayPal holds exactly one capture." : "Retrying the capture did not behave safely.", evidence));
  }
  return out;
}
