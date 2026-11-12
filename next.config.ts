import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Do not map server secrets into `env` here: Next.js inlines those values into the browser bundle.
};

export default nextConfig;
