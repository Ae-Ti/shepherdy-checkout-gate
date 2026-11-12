import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Quick fix from the AI assistant: expose the key so the button can debug PayPal calls.
  env: {
    NEXT_PUBLIC_PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
  },
};

export default nextConfig;
