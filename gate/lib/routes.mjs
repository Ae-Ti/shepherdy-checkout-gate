// The HTTP routes the gate calls on the app. An app with other paths sets "routes" in its gate.config.json;
// any key it leaves out keeps the default below. Request and response shapes stay the same (see README).
export const DEFAULT_ROUTES = Object.freeze({
  health: "/api/health",
  createBooking: "/api/bookings",
  createOrder: "/api/paypal/create-order",
  captureOrder: "/api/paypal/capture-order",
  bookingStatus: "/api/paypal/booking-status",
  bookPage: "/book/{bookingId}",
});

export function mergeRoutes(routes) {
  const out = { ...DEFAULT_ROUTES };
  if (routes && typeof routes === "object") {
    for (const [key, value] of Object.entries(routes)) {
      if (key in DEFAULT_ROUTES && typeof value === "string" && value.startsWith("/")) out[key] = value;
    }
  }
  return out;
}

// The path for one route, with {bookingId}-style placeholders filled in (URL-encoded).
export function routePath(ctx, key, params = {}) {
  const routes = ctx?.config?.routes ? mergeRoutes(ctx.config.routes) : DEFAULT_ROUTES;
  return routes[key].replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(String(params[name] ?? "")));
}

export function routeUrl(ctx, key, params) {
  return `${ctx.baseUrl}${routePath(ctx, key, params)}`;
}
