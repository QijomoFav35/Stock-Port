import type { NextConfig } from "next";

/**
 * Base Account (@base-org/account) depends on @coinbase/cdp-sdk, which imports the optional
 * x402 payment packages. We never use x402, so point those imports at a stub module
 * (lib/stubs/empty.js) instead of failing the build with "Module not found".
 */
const optionalX402 = [
  "@x402/core",
  "@x402/core/client",
  "@x402/core/schemas",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/auth-capture/client",
  "@x402/evm/batch-settlement/client",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/svm",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/svm/exact/v1/client",
  "@x402/svm/upto/client",
  "@x402/svm/upto/server",
  "@x402/extensions",
  "@x402/extensions/bazaar",
  "@x402/extensions/builder-code",
  "@x402/express",
  "@x402/fetch",
];
const STUB = "./lib/stubs/empty.js";

/** Basic hardening for every response. No CSP yet: wallet SDKs load popups and iframes we'd have to list first. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    resolveAlias: Object.fromEntries(optionalX402.map((m) => [m, STUB])),
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(optionalX402.map((m) => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
