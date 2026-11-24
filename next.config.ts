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

const nextConfig: NextConfig = {
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
