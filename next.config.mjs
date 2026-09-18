/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/google/invoices": ["./node_modules/@sparticuz/chromium/bin/**/*", "./node_modules/playwright-core/**/*"],
  },
};

export default nextConfig;
