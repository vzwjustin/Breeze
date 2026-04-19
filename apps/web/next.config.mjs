/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://openrouter.ai https://www.googleapis.com https://api.github.com https://oauth2.googleapis.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@breeze/ai",
    "@breeze/broker",
    "@breeze/common",
    "@breeze/connectors",
    "@breeze/db",
    "@breeze/memory",
    "@breeze/planner",
    "@breeze/policy",
    "@breeze/ui",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  webpack(config, { isServer }) {
    // Allow TypeScript packages that use ESM-style ".js" import extensions
    // to resolve correctly when transpiled by Next.js webpack.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    if (!isServer) {
      // Stub Node.js built-ins that must never reach the client bundle.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        buffer: false,
      };
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
