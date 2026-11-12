import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../gate/lib/gate.mjs";
import { DEFAULT_ROUTES, routePath, routeUrl } from "../gate/lib/routes.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("routes: this repo's gate.config.json keeps the default routes", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "gate.config.json"), "utf8"));
  const config = resolveConfig(raw);
  assert.deepEqual(config.routes, { ...DEFAULT_ROUTES });
  const ctx = { baseUrl: "http://127.0.0.1:3000", config };
  assert.equal(routeUrl(ctx, "health"), "http://127.0.0.1:3000/api/health");
  assert.equal(routeUrl(ctx, "createBooking"), "http://127.0.0.1:3000/api/bookings");
  assert.equal(routeUrl(ctx, "createOrder"), "http://127.0.0.1:3000/api/paypal/create-order");
  assert.equal(routeUrl(ctx, "captureOrder"), "http://127.0.0.1:3000/api/paypal/capture-order");
  assert.equal(routeUrl(ctx, "bookingStatus"), "http://127.0.0.1:3000/api/paypal/booking-status");
  assert.equal(routeUrl(ctx, "bookPage", { bookingId: "bk_0123abcd" }), "http://127.0.0.1:3000/book/bk_0123abcd");
});

test("routes: an app overrides some routes; the rest keep their defaults; junk is ignored", () => {
  const config = resolveConfig({
    routes: { createOrder: "/api/checkout/order", bookPage: "/orders/{bookingId}/pay", unknown: "/x", health: "no-slash" },
  });
  const ctx = { baseUrl: "https://shop.example", config };
  assert.equal(routePath(ctx, "createOrder"), "/api/checkout/order");
  assert.equal(routePath(ctx, "bookPage", { bookingId: "a b" }), "/orders/a%20b/pay");
  assert.equal(routePath(ctx, "health"), "/api/health");
  assert.equal(routePath(ctx, "captureOrder"), "/api/paypal/capture-order");
  assert.equal("unknown" in config.routes, false);
  // Other config keys still merge over the defaults.
  assert.equal(config.expectedAmount, "120.00");
});

test("routes: a ctx without routes (older callers) falls back to the defaults", () => {
  assert.equal(routePath({ config: {} }, "captureOrder"), "/api/paypal/capture-order");
});
