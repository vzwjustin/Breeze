/** @type {import('next').NextConfig} */
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
};
export default nextConfig;
